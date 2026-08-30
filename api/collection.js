// api/collection.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: byBranch, details
//
// ⚠️ "العجز والزيادة" هنا رقم حي محسوب فوراً (متوقع مقابل مستلم) لأغراض
// المتابعة اليومية — وهذا يختلف عن ملف reconciliation.js القادم الذي
// يدير دورة المطابقة الرسمية المعتمَدة (حالة/سبب/اعتماد) بجدول
// fin_branch_reconciliation. هذا الملف للمتابعة اللحظية، ذاك للاعتماد.
//
// ⚠️ قائمة الفروع نفسها لا تُخزَّن بأي جدول مالية — تُقرَأ مباشرة من
// settings_lists المركزية (list_key='branches') فقط عند الحاجة لعرض كل
// الفروع دفعة واحدة (أدمن بلا فرع محدَّد)، احتراماً لمبدأ "الفرع كيان
// مركزي مشترك" بمواصفاتك.
// =====================================================================

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';

const COLLECTION_ROLES_ = ['role_admin', 'role_finance_admin', 'role_collection_monitor'];

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

function defaultDateRange(body) {
  const now = new Date();
  const startDate = body.startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const endDate = body.endDate || now.toISOString().slice(0, 10);
  return { startDate, endDate };
}

function sum(list, mapper) { return list.reduce((s, item) => s + mapper(item), 0); }

/** يقرأ قائمة كل الفروع من settings_lists المركزية (بلا تكرار بجداول المالية) */
async function getAllBranches() {
  const { data, error } = await supabaseAdmin.from('settings_lists').select('value').eq('list_key', 'branches').order('sort_order');
  if (error) throw error;
  return (data || []).map((r) => r.value);
}

/* -------------------- التحصيل حسب الفروع -------------------- */
async function handleByBranch(req, res) {
  const user = requireAuth(req);
  requireRole(user, COLLECTION_ROLES_);
  const body = req.body || {};
  const { startDate, endDate } = defaultDateRange(body);
  const today = new Date().toISOString().slice(0, 10);

  let branches = resolveBranchScope(user, body.branch);
  if (!branches) branches = await getAllBranches();
  if (!branches.length) return res.status(200).json({ success: true, data: { period: { startDate, endDate }, branches: [] } });

  const [
    { data: invoices, error: invError },
    { data: voidInvoices, error: voidInvError },
    { data: payments, error: payError },
    { data: voidPayments, error: voidPayError },
    { data: overdueInvoices, error: overdueError },
  ] = await Promise.all([
    supabaseAdmin.from('fin_invoices').select('branch, total_amount, discount_amount').neq('status', 'void').in('branch', branches).gte('issue_date', startDate).lte('issue_date', endDate),
    supabaseAdmin.from('fin_invoices').select('branch, total_amount').eq('status', 'void').in('branch', branches).gte('issue_date', startDate).lte('issue_date', endDate),
    supabaseAdmin.from('fin_payments').select('branch, amount').eq('status', 'confirmed').in('branch', branches).gte('payment_date', startDate).lte('payment_date', endDate),
    supabaseAdmin.from('fin_payments').select('branch, amount').eq('status', 'void').in('branch', branches).gte('payment_date', startDate).lte('payment_date', endDate),
    supabaseAdmin.from('fin_invoices').select('branch, total_amount, paid_amount').in('status', ['unpaid', 'partially_paid']).in('branch', branches).not('due_date', 'is', null).lt('due_date', today),
  ]);
  if (invError) throw invError;
  if (voidInvError) throw voidInvError;
  if (payError) throw payError;
  if (voidPayError) throw voidPayError;
  if (overdueError) throw overdueError;

  const result = branches.map((branch) => {
    const branchInvoices = (invoices || []).filter((i) => i.branch === branch);
    const branchVoidInvoices = (voidInvoices || []).filter((i) => i.branch === branch);
    const branchPayments = (payments || []).filter((p) => p.branch === branch);
    const branchVoidPayments = (voidPayments || []).filter((p) => p.branch === branch);
    const branchOverdue = (overdueInvoices || []).filter((i) => i.branch === branch);

    const expected = sum(branchInvoices, (i) => Number(i.total_amount));
    const discounts = sum(branchInvoices, (i) => Number(i.discount_amount));
    const received = sum(branchPayments, (p) => Number(p.amount));
    const cancellations = sum(branchVoidInvoices, (i) => Number(i.total_amount));
    const returns = sum(branchVoidPayments, (p) => Number(p.amount));
    const overdue = sum(branchOverdue, (i) => Number(i.total_amount) - Number(i.paid_amount));
    const difference = received - expected;

    return {
      branch, expected, received, overdue, discounts, cancellations, returns, difference,
      status: difference < 0 ? 'عجز' : difference > 0 ? 'زيادة' : 'مطابق',
    };
  });

  return res.status(200).json({ success: true, data: { period: { startDate, endDate }, branches: result } });
}

/* -------------------- تفاصيل المبالغ المستلمة -------------------- */
async function handleDetails(req, res) {
  const user = requireAuth(req);
  requireRole(user, COLLECTION_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin
    .from('fin_payments')
    .select('id, payment_number, branch, amount, payment_date, reference_number, notes, status, student_id, invoice_id, recorded_by, payment_method_id')
    .order('payment_date', { ascending: false })
    .limit(500);
  query = applyBranchFilter(query, branches);
  if (!body.includeVoid) query = query.eq('status', 'confirmed');
  if (body.dateFrom) query = query.gte('payment_date', body.dateFrom);
  if (body.dateTo) query = query.lte('payment_date', body.dateTo);
  if (body.studentId) query = query.eq('student_id', body.studentId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const studentIds = [...new Set(rows.map((p) => p.student_id).filter(Boolean))];
  const invoiceIds = [...new Set(rows.map((p) => p.invoice_id).filter(Boolean))];
  const recorderIds = [...new Set(rows.map((p) => p.recorded_by).filter(Boolean))];
  const methodIds = [...new Set(rows.map((p) => p.payment_method_id).filter(Boolean))];

  const [{ data: students }, { data: invoiceRows }, { data: employees }, { data: methods }] = await Promise.all([
    studentIds.length ? supabaseAdmin.from('students').select('id, name_ar').in('id', studentIds) : { data: [] },
    invoiceIds.length ? supabaseAdmin.from('fin_invoices').select('id, invoice_number').in('id', invoiceIds) : { data: [] },
    recorderIds.length ? supabaseAdmin.from('employees').select('id, name_ar').in('id', recorderIds) : { data: [] },
    methodIds.length ? supabaseAdmin.from('fin_payment_methods').select('id, name').in('id', methodIds) : { data: [] },
  ]);

  const studentMap = Object.fromEntries((students || []).map((s) => [s.id, s.name_ar]));
  const invoiceMap = Object.fromEntries((invoiceRows || []).map((i) => [i.id, i.invoice_number]));
  const employeeMap = Object.fromEntries((employees || []).map((e) => [e.id, e.name_ar]));
  const methodMap = Object.fromEntries((methods || []).map((m) => [m.id, m.name]));

  const enriched = rows.map((p) => ({
    id: p.id, paymentNumber: p.payment_number, branch: p.branch, amount: Number(p.amount), paymentDate: p.payment_date,
    referenceNumber: p.reference_number, notes: p.notes, status: p.status,
    studentId: p.student_id, studentName: studentMap[p.student_id] || null,
    invoiceId: p.invoice_id, invoiceNumber: invoiceMap[p.invoice_id] || null,
    recordedByName: employeeMap[p.recorded_by] || null,
    paymentMethodName: methodMap[p.payment_method_id] || null,
  }));

  return res.status(200).json({ success: true, data: enriched });
}

export default createRouter({
  byBranch: handleByBranch,
  details: handleDetails,
});
