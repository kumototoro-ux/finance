// api/reconciliation.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: generateForPeriod, list, get, submitReason, resolve, approve
//
// دورة الحالة لكل صف (فرع × فترة مالية):
//   matched (لا فرق) ───────────────┐
//   deficit_review (عجز) ──┐        │
//   surplus_review (زيادة) ┴─ submitReason ─→ under_review ─ resolve ─→ resolved ─ approve ─→ approved
//
// ⚠️ "approved" حالة نهائية مقفَلة — generateForPeriod لا يعيد حساب أو
// يلمس أي صف بهذه الحالة إطلاقاً، حتى لو تغيّرت الأرقام لاحقاً (بند 7:
// "لا يسمح بتعديل الأرقام بهدف إخفاء الفرق"). كل تعديل حسّاس هنا يُسجَّل
// بسجل التدقيق المشترك.
// =====================================================================

import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import { validateBody, generateReconciliationSchema, reconciliationIdSchema, submitReconciliationReasonSchema } from '../lib/validation.js';

const VIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_collection_monitor'];
const REVIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_collection_monitor']; // تسجيل سبب + معالجة
const APPROVE_ROLES_ = ['role_admin', 'role_finance_admin']; // الاعتماد النهائي فقط

const HUMAN_LOCKED_STATUSES_ = ['under_review', 'resolved', 'approved']; // generateForPeriod لا يلمس status هذي إطلاقاً

const REASON_LABELS_ = {
  advance_payment_next_term: 'دفعة مقدمة لفصل قادم',
  prior_invoice_payment: 'دفعة تخص فاتورة سابقة',
  recording_error: 'تسجيل خاطئ',
  other_revenue: 'إيراد آخر',
  adjustment: 'تسوية',
  other: 'سبب آخر',
};

function sum(list, mapper) { return list.reduce((s, item) => s + mapper(item), 0); }

async function getAllBranches() {
  const { data, error } = await supabaseAdmin.from('settings_lists').select('value').eq('list_key', 'branches').order('sort_order');
  if (error) throw error;
  return (data || []).map((r) => r.value);
}

async function writeAudit(user, action, details, entityId) {
  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action, details, branch: user.branch, entity: 'fin_branch_reconciliation', entity_id: entityId || null, result: 'success',
  });
}

/* -------------------- توليد/تحديث المطابقة لفترة كاملة -------------------- */
async function handleGenerateForPeriod(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_.filter((r) => r !== 'role_collection_monitor')); // أدمن + أدمن مالية فقط يولّدون المطابقة
  const { periodId } = validateBody(generateReconciliationSchema, req.body);

  const { data: period, error: perError } = await supabaseAdmin.from('fin_financial_periods').select('*').eq('id', periodId).maybeSingle();
  if (perError) throw perError;
  if (!period) {
    const err = new Error('الفترة المالية غير موجودة');
    err.statusCode = 404;
    throw err;
  }
  if (period.status === 'closed') {
    const err = new Error('الفترة مُقفَلة — أعد فتحها أولاً قبل إعادة توليد المطابقة');
    err.statusCode = 403;
    throw err;
  }

  const branches = period.branch ? [period.branch] : await getAllBranches();
  if (!branches.length) return res.status(200).json({ success: true, data: [] });

  const [{ data: invoices, error: invError }, { data: payments, error: payError }, { data: existingRows, error: existError }] = await Promise.all([
    supabaseAdmin.from('fin_invoices').select('branch, total_amount').neq('status', 'void').in('branch', branches).gte('issue_date', period.start_date).lte('issue_date', period.end_date),
    supabaseAdmin.from('fin_payments').select('branch, amount').eq('status', 'confirmed').in('branch', branches).gte('payment_date', period.start_date).lte('payment_date', period.end_date),
    supabaseAdmin.from('fin_branch_reconciliation').select('*').eq('period_id', periodId),
  ]);
  if (invError) throw invError;
  if (payError) throw payError;
  if (existError) throw existError;

  const existingMap = Object.fromEntries((existingRows || []).map((r) => [r.branch, r]));
  const results = [];

  for (const branch of branches) {
    const expected = sum((invoices || []).filter((i) => i.branch === branch), (i) => Number(i.total_amount));
    const received = sum((payments || []).filter((p) => p.branch === branch), (p) => Number(p.amount));
    const autoStatus = expected === received ? 'matched' : (received < expected ? 'deficit_review' : 'surplus_review');
    const existing = existingMap[branch];

    if (existing && existing.status === 'approved') {
      results.push({ branch, skipped: true, note: 'مطابقة مُعتمَدة مسبقاً — لم تُعدَّل' });
      continue;
    }

    if (existing) {
      const updatePayload = { expected_amount: expected, received_amount: received };
      if (!HUMAN_LOCKED_STATUSES_.includes(existing.status)) updatePayload.status = autoStatus;
      const { error } = await supabaseAdmin.from('fin_branch_reconciliation').update(updatePayload).eq('id', existing.id);
      if (error) throw error;
      results.push({ branch, updated: true, expected, received, status: updatePayload.status || existing.status });
    } else {
      const { error } = await supabaseAdmin.from('fin_branch_reconciliation').insert({
        period_id: periodId, branch, expected_amount: expected, received_amount: received, status: autoStatus,
      });
      if (error) throw error;
      results.push({ branch, created: true, expected, received, status: autoStatus });
    }
  }

  await writeAudit(user, 'توليد/تحديث المطابقة المالية لفترة', { periodId, branchesCount: branches.length });
  return res.status(200).json({ success: true, data: results });
}

/* -------------------- قائمة صفوف المطابقة لفترة -------------------- */
async function handleList(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  if (!body.periodId) {
    const err = new Error('رقم الفترة المالية مطلوب');
    err.statusCode = 400;
    throw err;
  }

  let query = supabaseAdmin.from('fin_branch_reconciliation').select('*').eq('period_id', body.periodId).order('branch');
  if (body.status) query = query.eq('status', body.status);
  if (user.role === 'role_collection_monitor' && user.allBranches?.length) query = query.in('branch', user.allBranches);

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

/* -------------------- تفاصيل صف مطابقة واحد + العمليات المرتبطة بالفرق -------------------- */
async function handleGet(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const { reconciliationId } = validateBody(reconciliationIdSchema, req.body);

  const { data: row, error } = await supabaseAdmin.from('fin_branch_reconciliation').select('*, fin_financial_periods(name, start_date, end_date)').eq('id', reconciliationId).maybeSingle();
  if (error) throw error;
  if (!row) {
    const err = new Error('صف المطابقة غير موجود');
    err.statusCode = 404;
    throw err;
  }
  if (user.role === 'role_collection_monitor' && user.allBranches?.length && !user.allBranches.includes(row.branch)) {
    const err = new Error('غير مصرَّح لك بهذا الفرع');
    err.statusCode = 403;
    throw err;
  }

  const period = row.fin_financial_periods;
  const [{ data: invoices }, { data: payments }] = await Promise.all([
    supabaseAdmin.from('fin_invoices').select('id, invoice_number, student_id, total_amount, status').eq('branch', row.branch).neq('status', 'void').gte('issue_date', period.start_date).lte('issue_date', period.end_date),
    supabaseAdmin.from('fin_payments').select('id, payment_number, student_id, amount, payment_date, status').eq('branch', row.branch).eq('status', 'confirmed').gte('payment_date', period.start_date).lte('payment_date', period.end_date),
  ]);

  return res.status(200).json({ success: true, data: { reconciliation: row, invoices: invoices || [], payments: payments || [] } });
}

/* -------------------- تسجيل سبب الفرق (إلزامي عند وجود عجز/زيادة) -------------------- */
async function handleSubmitReason(req, res) {
  const user = requireAuth(req);
  requireRole(user, REVIEW_ROLES_);
  const d = validateBody(submitReconciliationReasonSchema, req.body);

  const { data: row, error: findError } = await supabaseAdmin.from('fin_branch_reconciliation').select('*').eq('id', d.reconciliationId).maybeSingle();
  if (findError) throw findError;
  if (!row) {
    const err = new Error('صف المطابقة غير موجود');
    err.statusCode = 404;
    throw err;
  }
  if (row.status === 'approved') {
    const err = new Error('هذه المطابقة مُعتمَدة بالفعل — لا يمكن تعديل سببها');
    err.statusCode = 403;
    throw err;
  }

  const { error } = await supabaseAdmin.from('fin_branch_reconciliation').update({
    reason: REASON_LABELS_[d.reasonCategory], notes: d.notes, attachment_url: d.attachmentUrl || null, status: 'under_review',
  }).eq('id', d.reconciliationId);
  if (error) throw error;

  // ⚠️ تعديل حسّاس — يُسجَّل بسجل التدقيق دائماً (بند 7 بمواصفاتك)
  await writeAudit(user, 'تسجيل سبب فرق مطابقة مالية', { branch: row.branch, reasonCategory: d.reasonCategory, notes: d.notes, previousStatus: row.status }, row.id);

  return res.status(200).json({ success: true, data: true });
}

/* -------------------- تمت المعالجة -------------------- */
async function handleResolve(req, res) {
  const user = requireAuth(req);
  requireRole(user, REVIEW_ROLES_);
  const { reconciliationId } = validateBody(reconciliationIdSchema, req.body);

  const { data: row, error: findError } = await supabaseAdmin.from('fin_branch_reconciliation').select('*').eq('id', reconciliationId).maybeSingle();
  if (findError) throw findError;
  if (!row) {
    const err = new Error('صف المطابقة غير موجود');
    err.statusCode = 404;
    throw err;
  }
  if (!row.reason) {
    const err = new Error('يجب تسجيل سبب الفرق أولاً قبل تمييزها كمُعالَجة');
    err.statusCode = 400;
    throw err;
  }

  const { error } = await supabaseAdmin.from('fin_branch_reconciliation').update({
    status: 'resolved', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  }).eq('id', reconciliationId);
  if (error) throw error;

  await writeAudit(user, 'تمييز مطابقة مالية كمُعالَجة', { branch: row.branch }, row.id);
  return res.status(200).json({ success: true, data: true });
}

/* -------------------- الاعتماد النهائي (أدمن فقط) -------------------- */
async function handleApprove(req, res) {
  const user = requireAuth(req);
  requireRole(user, APPROVE_ROLES_);
  const { reconciliationId } = validateBody(reconciliationIdSchema, req.body);

  const { data: row, error: findError } = await supabaseAdmin.from('fin_branch_reconciliation').select('*').eq('id', reconciliationId).maybeSingle();
  if (findError) throw findError;
  if (!row) {
    const err = new Error('صف المطابقة غير موجود');
    err.statusCode = 404;
    throw err;
  }
  if (row.status === 'deficit_review' || row.status === 'surplus_review' || row.status === 'under_review') {
    const err = new Error('يجب معالجة الفرق (تسجيل السبب ثم تمييزها كمُعالَجة) قبل الاعتماد');
    err.statusCode = 400;
    throw err;
  }
  if (row.status === 'approved') {
    const err = new Error('هذه المطابقة مُعتمَدة بالفعل');
    err.statusCode = 409;
    throw err;
  }

  const { error } = await supabaseAdmin.from('fin_branch_reconciliation').update({
    status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString(),
  }).eq('id', reconciliationId);
  if (error) throw error;

  await writeAudit(user, 'اعتماد مطابقة مالية نهائياً', { branch: row.branch, expectedAmount: row.expected_amount, receivedAmount: row.received_amount }, row.id);
  return res.status(200).json({ success: true, data: true });
}

export default createRouter({
  generateForPeriod: handleGenerateForPeriod,
  list: handleList,
  get: handleGet,
  submitReason: handleSubmitReason,
  resolve: handleResolve,
  approve: handleApprove,
});
