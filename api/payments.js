// api/payments.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: list, get, record, void, reportCollection
//
// ⚠️ تحوّل جوهري: الدفعة تُسجَّل على الطالب مباشرة وتُوزَّع على
// استحقاقاته (fin_dues) عبر جدول الربط fin_payment_allocations — لم
// تعد تحتاج فاتورة موجودة مسبقاً إطلاقاً. بلا توزيع يدوي مُرسَل، توزَّع
// تلقائياً على أقدم الاستحقاقات المفتوحة أولاً (FIFO).
//
// ✅ لا حاجة لاستدعاء أي RPC يدوي بعد التسجيل/الإلغاء — الـTrigger على
// fin_payment_allocations (وTrigger آخر لتغيّر حالة الدفعة نفسها) يُعيد
// حساب حالة كل استحقاق والحالة المالية للطالب تلقائياً وفورياً.
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

  const { data: invoice } = payment.invoice_id
    ? await supabaseAdmin.from('fin_invoices').select('invoice_number, total_amount, paid_amount, status').eq('id', payment.invoice_id).maybeSingle()
    : { data: null };
  const { data: allocations } = await supabaseAdmin
    .from('fin_payment_allocations').select('amount, fin_dues(description, fee_item_id)').eq('payment_id', paymentId);
  const { data: student } = await supabaseAdmin.from('students').select('id, name_ar, national_id, branch, stage, grade, section').eq('id', payment.student_id).maybeSingle();
  const { data: recorder } = payment.recorded_by ? await supabaseAdmin.from('employees').select('name_ar').eq('id', payment.recorded_by).maybeSingle() : { data: null };
  const { data: method } = payment.payment_method_id ? await supabaseAdmin.from('fin_payment_methods').select('name').eq('id', payment.payment_method_id).maybeSingle() : { data: null };

  return res.status(200).json({
    success: true,
    data: {
      payment, invoice, student, recorderName: recorder?.name_ar || null, paymentMethodName: method?.name || null,
      allocations: (allocations || []).map((a) => ({ amount: a.amount, description: a.fin_dues?.description || null })),
    },
  });
}

/* -------------------- تسجيل دفعة جديدة (على الاستحقاقات مباشرة) -------------------- */
async function handleRecord(req, res) {
  const user = requireAuth(req);
  requireRole(user, RECORD_ROLES_);
  const d = validateBody(recordPaymentSchema, req.body);

  const { data: student, error: stuError } = await supabaseAdmin
    .from('students').select('id, branch').eq('id', d.studentId).is('deleted_at', null).maybeSingle();
  if (stuError) throw stuError;
  if (!student) {
    const err = new Error('الطالب غير موجود');
    err.statusCode = 404;
    throw err;
  }

  const allowed = resolveBranchScope(user, null);
  if (allowed && !allowed.includes(student.branch)) {
    const err = new Error('غير مصرَّح لك بفرع هذا الطالب');
    err.statusCode = 403;
    throw err;
  }

  // الاستحقاقات المفتوحة، الأقدم أولاً (تاريخ استحقاق فأقدم تسجيل) — أساس التوزيع التلقائي (FIFO)
  const { data: openDues, error: duesError } = await supabaseAdmin
    .from('fin_dues').select('*').eq('student_id', d.studentId).in('status', ['due', 'partially_paid', 'overdue'])
    .order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
  if (duesError) throw duesError;

  let allocations;
  if (d.allocations && d.allocations.length) {
    // توزيع يدوي مُرسَل من المحاسب — يجب أن يطابق مجموعه المبلغ بالضبط، وكل استحقاق يخصّ نفس الطالب فعلاً
    allocations = d.allocations.map((a) => {
      const due = openDues.find((x) => String(x.id) === String(a.dueId));
      if (!due) {
        const err = new Error('أحد الاستحقاقات المحدَّدة بالتوزيع غير موجود ضمن استحقاقات هذا الطالب المفتوحة');
        err.statusCode = 400;
        throw err;
      }
      return { dueId: due.id, amount: a.amount, academicYear: due.academic_year, termId: due.term_id };
    });
    const allocatedSum = allocations.reduce((s, a) => s + a.amount, 0);
    if (Math.abs(allocatedSum - d.amount) > 0.01) {
      const err = new Error('مجموع التوزيع اليدوي يجب أن يساوي مبلغ الدفعة بالضبط');
      err.statusCode = 400;
      throw err;
    }
  } else {
    // توزيع تلقائي — أقدم استحقاق مفتوح أولاً حتى ينفد المبلغ أو تنتهي الاستحقاقات
    allocations = [];
    let remaining = d.amount;
    for (const due of openDues) {
      if (remaining <= 0) break;
      const dueRemaining = Number(due.amount) - Number(due.discount_amount) - Number(due.paid_amount);
      if (dueRemaining <= 0) continue;
      const apply = Math.min(dueRemaining, remaining);
      allocations.push({ dueId: due.id, amount: apply, academicYear: due.academic_year, termId: due.term_id });
      remaining -= apply;
    }
  }

  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
  const isOverpayment = totalAllocated < d.amount; // جزء من المبلغ بلا استحقاق مقابل له (دفعة مقدَّمة/زائدة)
  const firstAllocation = allocations[0];

  const paymentNumber = await generatePaymentNumber(supabaseAdmin);

  const { data: newPayment, error: insError } = await supabaseAdmin.from('fin_payments').insert({
    payment_number: paymentNumber, student_id: d.studentId, branch: student.branch,
    academic_year: firstAllocation?.academicYear || null, term_id: firstAllocation?.termId || null,
    amount: d.amount, payment_method_id: d.paymentMethodId, account_id: d.accountId || null,
    reference_number: d.referenceNumber || null, payment_date: d.paymentDate || new Date().toISOString().slice(0, 10),
    attachments: d.attachments && d.attachments.length ? d.attachments : null,
    notes: d.notes || null, recorded_by: user.id,
  }).select('id, payment_number').single();
  if (insError) throw insError;

  if (allocations.length) {
    const allocationRows = allocations.map((a) => ({ payment_id: newPayment.id, due_id: a.dueId, amount: a.amount }));
    const { error: allocError } = await supabaseAdmin.from('fin_payment_allocations').insert(allocationRows);
    if (allocError) throw allocError;
  }
  // الـTrigger على fin_payment_allocations أعاد حساب كل استحقاق متأثِّر + الحالة المالية للطالب تلقائياً بهذه اللحظة

  await writeAudit(user, 'تسجيل دفعة جديدة', {
    studentId: d.studentId, amount: d.amount, allocatedDuesCount: allocations.length, isOverpayment,
  }, newPayment.id);

  return res.status(200).json({
    success: true,
    data: { id: newPayment.id, paymentNumber: newPayment.payment_number, isOverpayment, allocatedCount: allocations.length },
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

  // الـTrigger أعاد حساب كل استحقاق مرتبط بهذه الدفعة + الحالة المالية للطالب تلقائياً بهذه اللحظة
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
