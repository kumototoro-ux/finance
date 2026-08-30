// api/finance-staff.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: list, add, update, delete, toggleStatus, resetPassword, auditLog
//
// حساب الأدمن الخاص بموقع الإدارة المالية هو من يضيف موظفي الفروع
// (المحاسبين) من هنا — بنفس تدفّق إنشاء حساب الدخول المعتمد بموقع
// الموظفين بالضبط:
//   1) توليد معرِّف فريد (EMP-XXXXXX) بنفس آلية idGenerator.js
//   2) كلمة المرور الابتدائية = رقم الهوية نفسه، مُشفَّر (bcrypt) من
//      البداية، بلا أي نص صريح مُخزَّن إطلاقاً
//   3) إجبار تغيير كلمة المرور بأول دخول (forceSetPassword بملف auth.js)
//   4) تسجيل كل عملية بسجل التدقيق المشترك audit_log
//
// ⚠️ الموظف المُنشَأ هنا هو صف حقيقي بجدول employees المركزي المشترك
// (لا يُعاد إنشاء بيانات موازية) — فقط بأدوار مالية محصورة، ومُدار حصراً
// من واجهة موقع المالية.
//
// ⚠️ ملاحظة تشغيلية: أول حساب "role_finance_admin" لا يوجد شاشة لإنشائه
// (مشكلة البيضة والدجاجة المعتادة) — يُنشَأ يدوياً مرة واحدة فقط بقاعدة
// البيانات مباشرة (insert بجدولي employees + users)، بنفس أسلوب إنشاء
// حساب E001 الأصلي بموقع الموظفين.
// =====================================================================

import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import {
  validateBody,
  addFinanceStaffSchema,
  updateFinanceStaffSchema,
  toggleFinanceStaffStatusSchema,
  resetFinanceStaffPasswordSchema,
} from '../lib/validation.js';
import { generateEmployeeId } from '../lib/idGenerator.js';

// من يملك صلاحية إدارة موظفي المالية — الأدمن العام + أدمن موقع المالية
const FINANCE_STAFF_MANAGE_ROLES_ = ['role_admin', 'role_finance_admin'];

// الأدوار المالية التي تُدار من هذه الشاشة فقط (بلا role_admin)
const FINANCE_STAFF_ROLES_ = ['role_finance_admin', 'role_accountant', 'role_collection_monitor'];

async function writeAudit(user, action, details, entityId) {
  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action, details, branch: user.branch,
    entity: 'finance_staff', entity_id: entityId || null, result: 'success',
  });
}

/* -------------------- قائمة موظفي المالية -------------------- */
async function handleList(req, res) {
  const user = requireAuth(req);
  requireRole(user, FINANCE_STAFF_MANAGE_ROLES_);

  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, national_id, name_ar, name_en, role, gender, branch, created_at, employee_branches(branch), users!users_id_fkey(status, last_login_at)')
    .in('role', FINANCE_STAFF_ROLES_)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const enriched = data.map((emp) => ({
    id: emp.id, nationalId: emp.national_id, nameAr: emp.name_ar, nameEn: emp.name_en,
    role: emp.role, gender: emp.gender, createdAt: emp.created_at,
    allBranches: [emp.branch, ...(emp.employee_branches || []).map((b) => b.branch)],
    status: emp.users?.status || 'inactive',
    lastLoginAt: emp.users?.last_login_at || null,
  }));
  return res.status(200).json({ success: true, data: enriched });
}

/* -------------------- إضافة موظف مالية جديد -------------------- */
async function handleAdd(req, res) {
  const user = requireAuth(req);
  requireRole(user, FINANCE_STAFF_MANAGE_ROLES_);
  const d = validateBody(addFinanceStaffSchema, req.body);

  const { data: existing } = await supabaseAdmin.from('employees').select('id').eq('national_id', d.nationalId).is('deleted_at', null).maybeSingle();
  if (existing) {
    const err = new Error('رقم الهوية هذا مسجَّل بالفعل لموظف آخر');
    err.statusCode = 409;
    throw err;
  }

  const newId = await generateEmployeeId(supabaseAdmin);

  const { error: empError } = await supabaseAdmin.from('employees').insert({
    id: newId, national_id: d.nationalId, name_ar: d.nameAr, name_en: d.nameEn || null,
    user_type: 'finance_staff', role: d.role, gender: d.gender || null, branch: d.branches[0],
    grades: [], sections: [], subjects: [],
  });
  if (empError) throw empError;

  if (d.branches.length > 1) {
    const extraBranches = d.branches.slice(1).map((branch) => ({ employee_id: newId, branch }));
    const { error: branchError } = await supabaseAdmin.from('employee_branches').insert(extraBranches);
    if (branchError) throw branchError;
  }

  // كلمة المرور الابتدائية = رقم الهوية، مُشفَّرة من البداية — يُجبَر على تغييرها بأول دخول
  const passwordHash = await bcrypt.hash(d.nationalId, 10);
  const { error: userError } = await supabaseAdmin.from('users').insert({
    id: newId, username: d.nationalId, password_hash: passwordHash, status: 'active',
  });
  if (userError) throw userError;

  await writeAudit(user, 'إضافة موظف مالية جديد', { newEmployeeId: newId, nameAr: d.nameAr, role: d.role }, newId);

  return res.status(200).json({ success: true, data: { id: newId } });
}

/* -------------------- تعديل موظف مالية -------------------- */
async function handleUpdate(req, res) {
  const user = requireAuth(req);
  requireRole(user, FINANCE_STAFF_MANAGE_ROLES_);
  const { id } = validateBody(z.object({ id: z.string().min(1) }).passthrough(), req.body);
  const d = validateBody(updateFinanceStaffSchema, req.body);

  const { data: existing } = await supabaseAdmin
    .from('employees').select('id').eq('id', id).in('role', FINANCE_STAFF_ROLES_).is('deleted_at', null).maybeSingle();
  if (!existing) {
    const err = new Error('الموظف غير موجود');
    err.statusCode = 404;
    throw err;
  }

  const { error: updateError } = await supabaseAdmin.from('employees').update({
    name_ar: d.nameAr, name_en: d.nameEn || null, role: d.role, gender: d.gender || null, branch: d.branches[0],
  }).eq('id', id);
  if (updateError) throw updateError;

  // إعادة بناء الفروع الإضافية بالكامل (نفس أسلوب أولياء الأمور بموقع الموظفين)
  await supabaseAdmin.from('employee_branches').delete().eq('employee_id', id);
  if (d.branches.length > 1) {
    const extraBranches = d.branches.slice(1).map((branch) => ({ employee_id: id, branch }));
    const { error: branchError } = await supabaseAdmin.from('employee_branches').insert(extraBranches);
    if (branchError) throw branchError;
  }

  await writeAudit(user, 'تعديل بيانات موظف مالية', { employeeId: id, nameAr: d.nameAr }, id);

  return res.status(200).json({ success: true, data: true });
}

/* -------------------- حذف موظف مالية (Soft Delete + تعطيل الحساب) -------------------- */
async function handleDelete(req, res) {
  const user = requireAuth(req);
  requireRole(user, FINANCE_STAFF_MANAGE_ROLES_);
  const { id } = validateBody(z.object({ id: z.string().min(1, 'رقم الموظف مطلوب') }), req.body);

  const { data: existing } = await supabaseAdmin
    .from('employees').select('id, name_ar').eq('id', id).in('role', FINANCE_STAFF_ROLES_).maybeSingle();
  if (!existing) {
    const err = new Error('الموظف غير موجود');
    err.statusCode = 404;
    throw err;
  }

  const { error } = await supabaseAdmin.from('employees').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  await supabaseAdmin.from('users').update({ status: 'inactive' }).eq('id', id);

  await writeAudit(user, 'حذف موظف مالية', { employeeId: id, nameAr: existing.name_ar }, id);

  return res.status(200).json({ success: true, data: true });
}

/* -------------------- تفعيل / تعطيل حساب -------------------- */
async function handleToggleStatus(req, res) {
  const user = requireAuth(req);
  requireRole(user, FINANCE_STAFF_MANAGE_ROLES_);
  const { id, newStatus } = validateBody(toggleFinanceStaffStatusSchema, req.body);

  const { data: existing } = await supabaseAdmin
    .from('employees').select('id').eq('id', id).in('role', FINANCE_STAFF_ROLES_).maybeSingle();
  if (!existing) {
    const err = new Error('الموظف غير موجود');
    err.statusCode = 404;
    throw err;
  }

  const { error } = await supabaseAdmin.from('users').update({ status: newStatus }).eq('id', id);
  if (error) throw error;

  await writeAudit(user, newStatus === 'active' ? 'تفعيل حساب موظف مالية' : 'تعطيل حساب موظف مالية', { employeeId: id }, id);

  return res.status(200).json({ success: true, data: true });
}

/* -------------------- إعادة تعيين كلمة مرور (رجوع لرقم الهوية) -------------------- */
async function handleResetPassword(req, res) {
  const user = requireAuth(req);
  requireRole(user, FINANCE_STAFF_MANAGE_ROLES_);
  const { id } = validateBody(resetFinanceStaffPasswordSchema, req.body);

  const { data: employee } = await supabaseAdmin
    .from('employees').select('national_id').eq('id', id).in('role', FINANCE_STAFF_ROLES_).maybeSingle();
  if (!employee) {
    const err = new Error('تعذّر إيجاد بيانات هذا الموظف');
    err.statusCode = 404;
    throw err;
  }

  const passwordHash = await bcrypt.hash(employee.national_id, 10);
  const { error } = await supabaseAdmin.from('users').update({ password_hash: passwordHash, password_changed_at: null }).eq('id', id);
  if (error) throw error;

  await writeAudit(user, 'إعادة تعيين كلمة مرور موظف مالية', { employeeId: id }, id);

  return res.status(200).json({ success: true, data: { tempPassword: employee.national_id } });
}

/* -------------------- سجل التدقيق (خاص بأحداث موقع المالية فقط) -------------------- */
// ⚠️ بلا فلتر تاريخ، يُحمَّل افتراضياً آخر 7 أيام فقط (بدل 300 صف دائماً)
// — نفس الحل المطبَّق بموقع الموظفين لتفادي ثقل الصفحة. يقدر المستخدم
// يوسّع الفترة يدوياً من الواجهة.
async function handleAuditLog(req, res) {
  const user = requireAuth(req);
  requireRole(user, FINANCE_STAFF_MANAGE_ROLES_);
  const body = req.body || {};

  const defaultFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dateFrom = body.dateFrom ? new Date(body.dateFrom).toISOString() : defaultFrom;

  let query = supabaseAdmin
    .from('audit_log')
    .select('*')
    .like('entity', 'fin%')
    .gte('created_at', dateFrom)
    .order('created_at', { ascending: false })
    .limit(300);
  if (body.dateTo) query = query.lte('created_at', new Date(body.dateTo).toISOString());
  if (body.branch) query = query.eq('branch', body.branch);

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

export default createRouter({
  list: handleList,
  add: handleAdd,
  update: handleUpdate,
  delete: handleDelete,
  toggleStatus: handleToggleStatus,
  resetPassword: handleResetPassword,
  auditLog: handleAuditLog,
});
