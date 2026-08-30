// api/financial-periods.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: list, get, create, advance, reopen
//
// دورة الفترة (بندك 8 بالمواصفات بالضبط):
//   open → under_review → reconciling → approved → closed
//
// "advance" ينقل الفترة للمرحلة التالية بالتسلسل فقط — لا يمكن تخطي
// مرحلة، ولا الرجوع للخلف إلا عبر "reopen" الصريح (صلاحية خاصة + سبب
// إلزامي + سجل تدقيق، بالضبط كما بندك: "أي تعديل بعد الإقفال يحتاج
// صلاحية خاصة وسبباً واضحاً").
// =====================================================================

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import { validateBody, createPeriodSchema, periodIdSchema, reopenPeriodSchema } from '../lib/validation.js';

const VIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant', 'role_collection_monitor'];
const MANAGE_ROLES_ = ['role_admin', 'role_finance_admin'];

const STATUS_SEQUENCE_ = ['open', 'under_review', 'reconciling', 'approved', 'closed'];

async function writeAudit(user, action, details, entityId) {
  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action, details, branch: user.branch, entity: 'fin_financial_periods', entity_id: entityId || null, result: 'success',
  });
}

/* -------------------- قائمة الفترات المالية -------------------- */
async function handleList(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};

  let query = supabaseAdmin.from('fin_financial_periods').select('*').order('start_date', { ascending: false });
  if (body.branch) query = query.eq('branch', body.branch);
  if (body.status) query = query.eq('status', body.status);

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

/* -------------------- تفاصيل فترة واحدة -------------------- */
async function handleGet(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const { periodId } = validateBody(periodIdSchema, req.body);

  const { data: period, error } = await supabaseAdmin.from('fin_financial_periods').select('*').eq('id', periodId).maybeSingle();
  if (error) throw error;
  if (!period) {
    const err = new Error('الفترة المالية غير موجودة');
    err.statusCode = 404;
    throw err;
  }

  const { count: reconciliationCount } = await supabaseAdmin.from('fin_branch_reconciliation').select('id', { count: 'exact', head: true }).eq('period_id', periodId);
  const { count: unresolvedCount } = await supabaseAdmin.from('fin_branch_reconciliation').select('id', { count: 'exact', head: true }).eq('period_id', periodId).in('status', ['deficit_review', 'surplus_review', 'under_review']);

  return res.status(200).json({ success: true, data: { period, reconciliationCount: reconciliationCount || 0, unresolvedCount: unresolvedCount || 0 } });
}

/* -------------------- فتح فترة مالية جديدة -------------------- */
async function handleCreate(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const d = validateBody(createPeriodSchema, req.body);

  const { data, error } = await supabaseAdmin.from('fin_financial_periods').insert({
    name: d.name, branch: d.branch || null, start_date: d.startDate, end_date: d.endDate,
    status: 'open', opened_by: user.id,
  }).select('id').single();
  if (error) throw error;

  await writeAudit(user, 'فتح فترة مالية جديدة', { name: d.name, branch: d.branch || 'كل الفروع', startDate: d.startDate, endDate: d.endDate }, data.id);
  return res.status(200).json({ success: true, data: { id: data.id } });
}

/* -------------------- التقدّم للمرحلة التالية بالتسلسل -------------------- */
async function handleAdvance(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const { periodId } = validateBody(periodIdSchema, req.body);

  const { data: period, error: findError } = await supabaseAdmin.from('fin_financial_periods').select('*').eq('id', periodId).maybeSingle();
  if (findError) throw findError;
  if (!period) {
    const err = new Error('الفترة المالية غير موجودة');
    err.statusCode = 404;
    throw err;
  }

  const currentIndex = STATUS_SEQUENCE_.indexOf(period.status);
  if (currentIndex === -1 || currentIndex === STATUS_SEQUENCE_.length - 1) {
    const err = new Error('هذه الفترة مُقفَلة بالفعل — استخدم إعادة الفتح إن لزم التعديل');
    err.statusCode = 409;
    throw err;
  }
  const nextStatus = STATUS_SEQUENCE_[currentIndex + 1];

  // ⚠️ لا يُسمح بالاعتماد قبل حل كل فروقات المطابقة المفتوحة (بند 7 و8 بمواصفاتك)
  if (nextStatus === 'approved') {
    const { count: total } = await supabaseAdmin.from('fin_branch_reconciliation').select('id', { count: 'exact', head: true }).eq('period_id', periodId);
    if (!total) {
      const err = new Error('يجب توليد المطابقة المالية لهذه الفترة أولاً قبل اعتمادها (من صفحة المطابقة)');
      err.statusCode = 400;
      throw err;
    }
    const { count: unresolved } = await supabaseAdmin.from('fin_branch_reconciliation').select('id', { count: 'exact', head: true }).eq('period_id', periodId).in('status', ['deficit_review', 'surplus_review', 'under_review']);
    if (unresolved) {
      const err = new Error(`يوجد ${unresolved} فرع لم تُعالَج فروقاته بعد — يجب معالجتها كلها قبل الاعتماد`);
      err.statusCode = 400;
      throw err;
    }
  }

  const updatePayload = { status: nextStatus };
  if (nextStatus === 'closed') {
    updatePayload.closed_by = user.id;
    updatePayload.closed_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin.from('fin_financial_periods').update(updatePayload).eq('id', periodId);
  if (error) throw error;

  await writeAudit(user, `تقدّم الفترة المالية: ${period.status} ← ${nextStatus}`, { periodId, from: period.status, to: nextStatus }, periodId);
  return res.status(200).json({ success: true, data: { status: nextStatus } });
}

/* -------------------- إعادة فتح فترة مُقفَلة (صلاحية خاصة + سبب إلزامي) -------------------- */
async function handleReopen(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const d = validateBody(reopenPeriodSchema, req.body);

  const { data: period, error: findError } = await supabaseAdmin.from('fin_financial_periods').select('*').eq('id', d.periodId).maybeSingle();
  if (findError) throw findError;
  if (!period) {
    const err = new Error('الفترة المالية غير موجودة');
    err.statusCode = 404;
    throw err;
  }
  if (period.status !== 'closed') {
    const err = new Error('هذه الفترة ليست مُقفَلة أصلاً');
    err.statusCode = 409;
    throw err;
  }

  const { error } = await supabaseAdmin.from('fin_financial_periods').update({
    status: 'under_review', reopened_by: user.id, reopened_at: new Date().toISOString(), reopen_reason: d.reason,
  }).eq('id', d.periodId);
  if (error) throw error;

  // ⚠️ عملية حسّاسة جداً — سجل تدقيق مفصَّل إلزامي (بند 8 بمواصفاتك بالضبط)
  await writeAudit(user, 'إعادة فتح فترة مالية مُقفَلة', { periodId: d.periodId, reason: d.reason, previousStatus: 'closed' }, d.periodId);

  return res.status(200).json({ success: true, data: true });
}

export default createRouter({
  list: handleList,
  get: handleGet,
  create: handleCreate,
  advance: handleAdvance,
  reopen: handleReopen,
});
