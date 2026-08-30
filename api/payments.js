// api/payments.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: list, get, record, void, reportCollection
//
// ✅ لا حاجة هنا لاستدعاء أي RPC يدوي بعد التسجيل/الإلغاء — الـTrigger
// المربوط بجدول fin_payments (راجع ملف SQL الأساسي) يُعيد حساب حالة
// الفاتورة (fin_invoices) والحالة المالية للطالب (fin_student_clearance)
// تلقائياً عند كل INSERT/UPDATE/DELETE بهذا الجدول — هذا بالضبط الفرق
// عن ملف invoices.js اللي احتاج استدعاءً يدوياً.
// =====================================================================

import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import { validateBody, recordPaymentSchema, voidPaymentSchema } from '../lib/validation.js';
import { generatePaymentNumber } from '../lib/idGenerator.js';

const VIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant', 'role_collection_monitor'];
const RECORD_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant'];
const VOID_ROLES_ = ['role_admin', 'role_finance_admin'];

/** نفس مبدأ resolveBranchScope بالملفات السابقة بالضبط — مكرَّر عمداً (كل ملف مستقل تماماً) */
function resolveBranchScope(user, requestedBranch) {
  const isFullAccess = user.role === 'role_admin' || user.role === 'role_finance_admin';
  if (isFullAccess) return requestedBranch ? [requestedBranch] : null;
  const allowed = (user.allBranches && user.allBranches.length) ? user.allBranches : [user.branch];
  if (requestedBranch) {
    if (!allowed.includes(requestedBranch)) {
      const err = new Error('غير مصرَّح لك بهذا الفرع');
      err.statusCode = 403;
      throw err;
    }
    return [requestedBranch];
  }
  return allowed;
}

function applyBranchFilter(query, branches) {
  if (!branches) return query;
  return branches.length === 1 ? query.eq('branch', branches[0]) : query.in('branch', branches);
}

async function writeAudit(user, action, details, entityId) {
  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action, details, branch: user.branch, entity: 'fin_payments', entity_id: entityId || null, result: 'success',
  });
}

/* -------------------- قائمة الدفعات -------------------- */
async function handleList(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin
    .from('fin_payments')
    .select('id, payment_number, invoice_id, student_id, branch, amount, payment_method_id, reference_number, payment_date, status, recorded_by, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  query = applyBranchFilter(query, branches);
  if (body.studentId) query = query.eq('student_id', body.studentId);
  if (body.invoiceId) query = query.eq('invoice_id', body.invoiceId);
  if (body.status) query = query.eq('status', body.status);
  if (body.paymentMethodId) query = query.eq('payment_method_id', body.paymentMethodId);
  if (body.dateFrom) query = query.gte('payment_date', body.dateFrom);
  if (body.dateTo) query = query.lte('payment_date', body.dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

/* -------------------- تفاصيل دفعة واحدة -------------------- */
async function handleGet(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const { paymentId } = validateBody(z.object({ paymentId: z.union([z.string(), z.number()]) }), req.body);

  const { data: payment, error } = await supabaseAdmin.from('fin_payments').select('*').eq('id', paymentId).maybeSingle();
  if (error) throw error;
  if (!payment) {
    const err = new Error('الدفعة غير موجودة');
    err.statusCode = 404;
    throw err;
  }

  const allowed = resolveBranchScope(user, null);
  if (allowed && !allowed.includes(payment.branch)) {
    const err = new Error('غير مصرَّح لك بفرع هذه الدفعة');
    err.statusCode = 403;
    throw err;
  }

  const { data: invoice } = await supabaseAdmin.from('fin_invoices').select('invoice_number, total_amount, paid_amount, status').eq('id', payment.invoice_id).maybeSingle();
  const { data: student } = await supabaseAdmin.from('students').select('id, name_ar, national_id, branch, stage, grade, section').eq('id', payment.student_id).maybeSingle();
  const { data: recorder } = payment.recorded_by ? await supabaseAdmin.from('employees').select('name_ar').eq('id', payment.recorded_by).maybeSingle() : { data: null };
  const { data: method } = payment.payment_method_id ? await supabaseAdmin.from('fin_payment_methods').select('name').eq('id', payment.payment_method_id).maybeSingle() : { data: null };

  return res.status(200).json({
    success: true,
    data: { payment, invoice, student, recorderName: recorder?.name_ar || null, paymentMethodName: method?.name || null },
  });
}

/* -------------------- تسجيل دفعة جديدة -------------------- */
async function handleRecord(req, res) {
  const user = requireAuth(req);
  requireRole(user, RECORD_ROLES_);
  const d = validateBody(recordPaymentSchema, req.body);

  const { data: invoice, error: invError } = await supabaseAdmin
    .from('fin_invoices').select('id, student_id, branch, academic_year, term_id, status, total_amount, paid_amount, period_id, invoice_number').eq('id', d.invoiceId).maybeSingle();
  if (invError) throw invError;
  if (!invoice) {
    const err = new Error('الفاتورة غير موجودة');
    err.statusCode = 404;
    throw err;
  }
  if (invoice.status === 'void') {
    const err = new Error('لا يمكن تسجيل دفعة على فاتورة مُلغاة');
    err.statusCode = 409;
    throw err;
  }

  const allowed = resolveBranchScope(user, null);
  if (allowed && !allowed.includes(invoice.branch)) {
    const err = new Error('غير مصرَّح لك بفرع هذه الفاتورة');
    err.statusCode = 403;
    throw err;
  }

  // ⚠️ نفس قيد الفترة المُقفَلة المطبَّق بملف invoices.js بالضبط
  if (invoice.period_id) {
    const { data: period } = await supabaseAdmin.from('fin_financial_periods').select('status').eq('id', invoice.period_id).maybeSingle();
    if (period && period.status === 'closed') {
      const err = new Error('هذه الفاتورة ضمن فترة مالية مُقفَلة — لا يمكن تسجيل دفعة جديدة عليها إلا بصلاحية خاصة بعد إعادة فتح الفترة');
      err.statusCode = 403;
      throw err;
    }
  }

  const remainingBefore = Number(invoice.total_amount) - Number(invoice.paid_amount);
  const isOverpayment = d.amount > remainingBefore;

  const paymentNumber = await generatePaymentNumber(supabaseAdmin);

  const { data: newPayment, error: insError } = await supabaseAdmin.from('fin_payments').insert({
    payment_number: paymentNumber, invoice_id: d.invoiceId, student_id: invoice.student_id, branch: invoice.branch,
    academic_year: invoice.academic_year, term_id: invoice.term_id, amount: d.amount,
    payment_method_id: d.paymentMethodId, account_id: d.accountId || null, reference_number: d.referenceNumber || null,
    payment_date: d.paymentDate || new Date().toISOString().slice(0, 10),
    attachments: d.attachments && d.attachments.length ? d.attachments : null,
    notes: d.notes || null, recorded_by: user.id,
  }).select('id, payment_number').single();
  if (insError) throw insError;

  // الـTrigger أعاد حساب حالة الفاتورة والحالة المالية للطالب تلقائياً بهذه اللحظة
  await writeAudit(user, 'تسجيل دفعة جديدة', { invoiceNumber: invoice.invoice_number, amount: d.amount, isOverpayment }, newPayment.id);

  return res.status(200).json({
    success: true,
    data: { id: newPayment.id, paymentNumber: newPayment.payment_number, isOverpayment },
  });
}

/* -------------------- إلغاء دفعة (Void قابل للتتبع، بلا حذف فعلي) -------------------- */
async function handleVoid(req, res) {
  const user = requireAuth(req);
  requireRole(user, VOID_ROLES_);
  const d = validateBody(voidPaymentSchema, req.body);

  const { data: payment, error: findError } = await supabaseAdmin.from('fin_payments').select('*').eq('id', d.paymentId).maybeSingle();
  if (findError) throw findError;
  if (!payment) {
    const err = new Error('الدفعة غير موجودة');
    err.statusCode = 404;
    throw err;
  }
  if (payment.status === 'void') {
    const err = new Error('هذه الدفعة مُلغاة بالفعل');
    err.statusCode = 409;
    throw err;
  }

  if (payment.period_id) {
    const { data: period } = await supabaseAdmin.from('fin_financial_periods').select('status').eq('id', payment.period_id).maybeSingle();
    if (period && period.status === 'closed') {
      const err = new Error('هذه الدفعة ضمن فترة مالية مُقفَلة — لا يمكن إلغاؤها إلا بصلاحية خاصة بعد إعادة فتح الفترة');
      err.statusCode = 403;
      throw err;
    }
  }

  const { error: voidError } = await supabaseAdmin.from('fin_payments').update({
    status: 'void', voided_by: user.id, voided_at: new Date().toISOString(), void_reason: d.reason,
  }).eq('id', d.paymentId);
  if (voidError) throw voidError;

  // الـTrigger أعاد حساب حالة الفاتورة والحالة المالية للطالب تلقائياً بهذه اللحظة
  await writeAudit(user, 'إلغاء دفعة', { paymentNumber: payment.payment_number, reason: d.reason }, payment.id);

  return res.status(200).json({ success: true, data: true });
}

/* -------------------- تقرير التحصيل العام (بفترة + فرع، مع تجميع يومي) -------------------- */
async function handleReportCollection(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin
    .from('fin_payments')
    .select('branch, amount, payment_date, payment_method_id')
    .eq('status', 'confirmed');
  query = applyBranchFilter(query, branches);
  if (body.dateFrom) query = query.gte('payment_date', body.dateFrom);
  if (body.dateTo) query = query.lte('payment_date', body.dateTo);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const total = rows.reduce((s, p) => s + Number(p.amount), 0);

  const byBranch = {};
  const byDate = {};
  rows.forEach((p) => {
    byBranch[p.branch] = (byBranch[p.branch] || 0) + Number(p.amount);
    byDate[p.payment_date] = (byDate[p.payment_date] || 0) + Number(p.amount);
  });

  return res.status(200).json({
    success: true,
    data: {
      total,
      count: rows.length,
      byBranch: Object.entries(byBranch).map(([branch, amount]) => ({ branch, amount })),
      byDate: Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })),
    },
  });
}

export default createRouter({
  list: handleList,
  get: handleGet,
  record: handleRecord,
  void: handleVoid,
  reportCollection: handleReportCollection,
});
