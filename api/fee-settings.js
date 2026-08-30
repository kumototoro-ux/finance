// api/fee-settings.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// كل الإعدادات المرجعية بملف واحد (تفادياً لتجاوز حد الـ12 ملف):
//   - بنود الرسوم (fin_fee_items)
//   - إعداد الرسوم الدراسية حسب العام/الفصل/الفرع/الصف (fin_fee_structure)
//   - تصنيفات المصروفات (fin_expense_categories)
//   - طرق الدفع (fin_payment_methods)
//   - الحسابات المالية (fin_accounts)
//
// ⚠️ تعديل الرسوم هنا لا يغيّر أبداً فواتير سابقة صادرة فعلاً — الفاتورة
// تخزّن نسخة (snapshot) من المبلغ وقت الإصدار (راجع fin_invoices.total_amount).
//
// كل الإجراءات هنا أدمن فقط (role_admin أو role_finance_admin) — هذي
// إعدادات تشكيلية تؤثر على كل فرع ومحاسب بالنظام.
// =====================================================================

import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import {
  validateBody,
  addLookupNameSchema,
  toggleLookupActiveSchema,
  setFeeStructureSchema,
  addAccountSchema,
  updateAccountSchema,
} from '../lib/validation.js';

const SETTINGS_MANAGE_ROLES_ = ['role_admin', 'role_finance_admin'];

async function writeAudit(user, action, details) {
  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action, details, branch: user.branch, entity: 'fin_settings', result: 'success',
  });
}

/**
 * مصنع دوال جاهزة لأي قائمة مرجعية بسيطة بشكل (id, name, is_active) —
 * يُستخدَم لبنود الرسوم/تصنيفات المصروفات/طرق الدفع الثلاثة، تفادياً
 * لتكرار نفس الكود ثلاث مرات بنفس الملف.
 */
function makeSimpleLookupHandlers(tableName, arabicLabel) {
  async function list(req, res) {
    const user = requireAuth(req);
    requireRole(user, SETTINGS_MANAGE_ROLES_);
    const { data, error } = await supabaseAdmin.from(tableName).select('*').order('name');
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  }

  async function add(req, res) {
    const user = requireAuth(req);
    requireRole(user, SETTINGS_MANAGE_ROLES_);
    const d = validateBody(addLookupNameSchema, req.body);

    const { data, error } = await supabaseAdmin.from(tableName).insert({ name: d.name }).select('id').single();
    if (error) {
      if (error.code === '23505') {
        const err = new Error(`${arabicLabel} بهذا الاسم موجود بالفعل`);
        err.statusCode = 409;
        throw err;
      }
      throw error;
    }

    await writeAudit(user, `إضافة ${arabicLabel}: ${d.name}`, { table: tableName, name: d.name });
    return res.status(200).json({ success: true, data: { id: data.id } });
  }

  async function toggleActive(req, res) {
    const user = requireAuth(req);
    requireRole(user, SETTINGS_MANAGE_ROLES_);
    const d = validateBody(toggleLookupActiveSchema, req.body);

    const { error } = await supabaseAdmin.from(tableName).update({ is_active: d.isActive }).eq('id', d.id);
    if (error) throw error;

    await writeAudit(user, `${d.isActive ? 'تفعيل' : 'تعطيل'} ${arabicLabel}`, { table: tableName, id: d.id });
    return res.status(200).json({ success: true, data: true });
  }

  return { list, add, toggleActive };
}

const feeItems = makeSimpleLookupHandlers('fin_fee_items', 'بند رسوم');
const expenseCategories = makeSimpleLookupHandlers('fin_expense_categories', 'تصنيف مصروف');
const paymentMethods = makeSimpleLookupHandlers('fin_payment_methods', 'طريقة دفع');

/* -------------------- إعداد الرسوم الدراسية (fin_fee_structure) -------------------- */
async function handleListFeeStructure(req, res) {
  const user = requireAuth(req);
  requireRole(user, SETTINGS_MANAGE_ROLES_);
  const body = req.body || {};

  let query = supabaseAdmin
    .from('fin_fee_structure')
    .select('id, academic_year, term_id, branch, grade, amount, is_active, fin_fee_items(id, name)')
    .order('branch').order('grade');
  if (body.academicYear) query = query.eq('academic_year', body.academicYear);
  if (body.termId) query = query.eq('term_id', body.termId);
  if (body.branch) query = query.eq('branch', body.branch);

  const { data, error } = await query;
  if (error) throw error;

  const result = (data || []).map((r) => ({
    id: r.id, academicYear: r.academic_year, termId: r.term_id, branch: r.branch, grade: r.grade,
    feeItemId: r.fin_fee_items?.id, feeItemName: r.fin_fee_items?.name, amount: Number(r.amount), isActive: r.is_active,
  }));
  return res.status(200).json({ success: true, data: result });
}

/** إضافة أو تحديث رسوم بند معيّن لعام+فصل+فرع+صف — Upsert على المفتاح المركَّب */
async function handleSetFeeStructure(req, res) {
  const user = requireAuth(req);
  requireRole(user, SETTINGS_MANAGE_ROLES_);
  const d = validateBody(setFeeStructureSchema, req.body);

  const { error } = await supabaseAdmin.from('fin_fee_structure').upsert({
    academic_year: d.academicYear, term_id: d.termId, branch: d.branch, grade: d.grade,
    fee_item_id: d.feeItemId, amount: d.amount, is_active: true, created_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'academic_year,term_id,branch,grade,fee_item_id' });
  if (error) throw error;

  await writeAudit(user, 'إعداد/تعديل رسوم دراسية', d);
  return res.status(200).json({ success: true, data: true });
}

async function handleToggleFeeStructureActive(req, res) {
  const user = requireAuth(req);
  requireRole(user, SETTINGS_MANAGE_ROLES_);
  const d = validateBody(toggleLookupActiveSchema, req.body);

  const { error } = await supabaseAdmin.from('fin_fee_structure').update({ is_active: d.isActive }).eq('id', d.id);
  if (error) throw error;

  await writeAudit(user, d.isActive ? 'تفعيل بند رسوم دراسية' : 'تعطيل بند رسوم دراسية', { id: d.id });
  return res.status(200).json({ success: true, data: true });
}

/* -------------------- الحسابات المالية (fin_accounts) -------------------- */
async function handleListAccounts(req, res) {
  const user = requireAuth(req);
  requireRole(user, SETTINGS_MANAGE_ROLES_);
  const { data, error } = await supabaseAdmin.from('fin_accounts').select('*').order('name');
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

async function handleAddAccount(req, res) {
  const user = requireAuth(req);
  requireRole(user, SETTINGS_MANAGE_ROLES_);
  const d = validateBody(addAccountSchema, req.body);

  const { data, error } = await supabaseAdmin.from('fin_accounts').insert({
    name: d.name, account_type: d.accountType, branch: d.branch || null, account_number: d.accountNumber || null,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') {
      const err = new Error('يوجد حساب بنفس الاسم لهذا الفرع بالفعل');
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }

  await writeAudit(user, `إضافة حساب مالي: ${d.name}`, d);
  return res.status(200).json({ success: true, data: { id: data.id } });
}

async function handleUpdateAccount(req, res) {
  const user = requireAuth(req);
  requireRole(user, SETTINGS_MANAGE_ROLES_);
  const d = validateBody(updateAccountSchema, req.body);

  const { error } = await supabaseAdmin.from('fin_accounts').update({
    name: d.name, account_type: d.accountType, branch: d.branch || null, account_number: d.accountNumber || null,
  }).eq('id', d.id);
  if (error) throw error;

  await writeAudit(user, `تعديل حساب مالي: ${d.name}`, { id: d.id });
  return res.status(200).json({ success: true, data: true });
}

async function handleToggleAccountActive(req, res) {
  const user = requireAuth(req);
  requireRole(user, SETTINGS_MANAGE_ROLES_);
  const d = validateBody(toggleLookupActiveSchema, req.body);

  const { error } = await supabaseAdmin.from('fin_accounts').update({ is_active: d.isActive }).eq('id', d.id);
  if (error) throw error;

  await writeAudit(user, d.isActive ? 'تفعيل حساب مالي' : 'تعطيل حساب مالي', { id: d.id });
  return res.status(200).json({ success: true, data: true });
}

/* -------------------- معلومات المدرسة العامة (بلا مصادقة إلزامية) -------------------- */
// ⚠️ site_settings جدول مركزي مشترك مملوك لموقع الموظفين — قراءة فقط
// هنا، بلا أي كتابة عليه إطلاقاً من موقع المالية. يُستخدَم لعرض شعار
// المدرسة واسمها الحقيقيَّين بالشريط العلوي (بدل شعار المنصة المكرَّر).
async function handleGetSiteInfo(req, res) {
  const { data, error } = await supabaseAdmin.from('site_settings').select('school_name, logo_url').eq('id', 1).maybeSingle();
  if (error) throw error;
  return res.status(200).json({
    success: true,
    data: { schoolName: data?.school_name || null, logoUrl: data?.logo_url || null },
  });
}

export default createRouter({
  getSiteInfo: handleGetSiteInfo,

  // بنود الرسوم
  listFeeItems: feeItems.list,
  addFeeItem: feeItems.add,
  toggleFeeItemActive: feeItems.toggleActive,

  // تصنيفات المصروفات
  listExpenseCategories: expenseCategories.list,
  addExpenseCategory: expenseCategories.add,
  toggleExpenseCategoryActive: expenseCategories.toggleActive,

  // طرق الدفع
  listPaymentMethods: paymentMethods.list,
  addPaymentMethod: paymentMethods.add,
  togglePaymentMethodActive: paymentMethods.toggleActive,

  // إعداد الرسوم الدراسية
  listFeeStructure: handleListFeeStructure,
  setFeeStructure: handleSetFeeStructure,
  toggleFeeStructureActive: handleToggleFeeStructureActive,

  // الحسابات المالية
  listAccounts: handleListAccounts,
  addAccount: handleAddAccount,
  updateAccount: handleUpdateAccount,
  toggleAccountActive: handleToggleAccountActive,
});
