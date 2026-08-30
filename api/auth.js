// api/auth.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: { action: 'login', username, password }
//           { action: 'logout' }
//           { action: 'forceSetPassword', newPassword }
//
// ⚠️ يستخدم نفس جدولي users/employees المركزيين بالضبط (قاعدة بيانات
// واحدة مشتركة مع موقع الموظفين) — لكن الدخول هنا محصور بأدوار مالية
// فقط (FINANCE_ROLES_). موظف بدور "role_teacher" مثلاً يملك حساباً
// صحيحاً بالنظام لكن يُرفَض دخوله لهذا الموقع تحديداً.
//
// موظفو المالية أنفسهم (role_finance_admin, role_accountant,
// role_collection_monitor) يُنشَأون ويُدارون بالكامل من داخل موقع
// المالية نفسه (راجع api/finance-staff.js) — بلا أي حاجة لتعديل موقع
// الموظفين إطلاقاً.
// =====================================================================

import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, issueSessionToken } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import { validateBody, loginSchema, forceSetNewPasswordSchema } from '../lib/validation.js';
import { checkLoginRateLimit } from '../lib/rateLimit.js';

// الأدوار المسموح لها بالدخول لموقع الإدارة المالية فقط
const FINANCE_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant', 'role_collection_monitor'];

/* -------------------- تسجيل الدخول -------------------- */
async function handleLogin(req, res) {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  await checkLoginRateLimit(clientIp);

  const { username, password } = validateBody(loginSchema, req.body);

  const { data: userRow, error } = await supabaseAdmin
    .from('users')
    .select(`
      id, username, password_hash, status,
      employees:id ( id, national_id, name_ar, branch, role, user_type, employee_branches(branch) )
    `)
    .eq('username', username)
    .maybeSingle();

  if (error) throw error;
  if (!userRow) {
    await supabaseAdmin.from('audit_log').insert({
      emp_id: null, emp_name: username, role: null,
      action: 'محاولة دخول فاشلة (اسم مستخدم غير موجود)', details: { ip: clientIp },
      branch: null, entity: 'finance_auth', result: 'failed', ip_address: clientIp,
    });
    const err = new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    err.statusCode = 401;
    throw err;
  }

  const passwordMatches = await bcrypt.compare(password, userRow.password_hash);
  if (!passwordMatches) {
    await supabaseAdmin.from('audit_log').insert({
      emp_id: userRow.id, emp_name: username, role: null,
      action: 'محاولة دخول فاشلة (كلمة مرور خاطئة)', details: { ip: clientIp },
      branch: null, entity: 'finance_auth', entity_id: userRow.id, result: 'failed', ip_address: clientIp,
    });
    const err = new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    err.statusCode = 401;
    throw err;
  }

  if (userRow.status !== 'active') {
    const err = new Error('الحساب غير مُفعّل، تواصل مع الإدارة');
    err.statusCode = 403;
    throw err;
  }

  const employee = userRow.employees;

  if (!FINANCE_ROLES_.includes(employee.role)) {
    await supabaseAdmin.from('audit_log').insert({
      emp_id: employee.id, emp_name: employee.name_ar, role: employee.role,
      action: 'محاولة دخول مرفوضة (بلا صلاحية مالية)', details: { ip: clientIp },
      branch: employee.branch, entity: 'finance_auth', entity_id: employee.id, result: 'failed', ip_address: clientIp,
    });
    const err = new Error('هذا الحساب لا يملك صلاحية الدخول إلى موقع الإدارة المالية');
    err.statusCode = 403;
    throw err;
  }

  const isFirstLogin = await bcrypt.compare(employee.national_id, userRow.password_hash);

  const allBranches = [employee.branch, ...(employee.employee_branches || []).map((b) => b.branch)];
  const userPayload = {
    id: employee.id,
    fullName: employee.name_ar,
    username: userRow.username,
    branch: employee.branch,
    allBranches,
    userType: employee.user_type,
    role: employee.role,
  };

  const token = issueSessionToken(userPayload);

  await supabaseAdmin.from('audit_log').insert({
    emp_id: employee.id, emp_name: employee.name_ar, role: employee.role,
    action: 'تسجيل دخول ناجح (الإدارة المالية)', details: { ip: clientIp, firstLogin: isFirstLogin },
    branch: employee.branch, entity: 'finance_auth', entity_id: employee.id, result: 'success', ip_address: clientIp,
  });

  return res.status(200).json({ success: true, data: { token, user: userPayload, firstLogin: isFirstLogin } });
}

/* -------------------- تسجيل الخروج -------------------- */
async function handleLogout(req, res) {
  return res.status(200).json({ success: true, data: true });
}

/* -------------------- تعيين كلمة مرور جديدة إجبارياً (أول دخول) -------------------- */
async function handleForceSetPassword(req, res) {
  const user = requireAuth(req);
  const { newPassword } = validateBody(forceSetNewPasswordSchema, req.body);

  const { data: userRow } = await supabaseAdmin.from('users').select('password_changed_at').eq('id', user.id).maybeSingle();
  if (userRow?.password_changed_at) {
    const daysSinceChange = (Date.now() - new Date(userRow.password_changed_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceChange < 30) {
      const daysLeft = Math.ceil(30 - daysSinceChange);
      const err = new Error(`يمكنك تغيير كلمة المرور مرة واحدة كل 30 يوماً فقط. تبقّى ${daysLeft} يوماً.`);
      err.statusCode = 429;
      throw err;
    }
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabaseAdmin.from('users').update({
    password_hash: newHash,
    password_changed_at: new Date().toISOString(),
  }).eq('id', user.id);
  if (error) throw error;

  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action: 'تغيير كلمة المرور (الإدارة المالية)', details: {},
    branch: user.branch, entity: 'finance_auth', entity_id: user.id, result: 'success',
  });

  return res.status(200).json({ success: true, data: true });
}

export default createRouter({
  login: handleLogin,
  logout: handleLogout,
  forceSetPassword: handleForceSetPassword,
});
