// api/dashboard.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: getMainDashboard, getCollectionDashboard — كلاهما قراءة فقط
// (مؤشرات مجمّعة)، بلا أي كتابة بقاعدة البيانات.
//
// ⚠️ نتبع نفس أسلوب الموقع الأصلي بالتجميع: نجلب الصفوف الخام ثم نجمعها
// بجافاسكربت (بدل الاعتماد على صيغ SUM/COUNT المعقّدة بـ PostgREST) —
// نفس مبدأ computeScore بملف behavior.js بالضبط.
// =====================================================================

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';

const DASHBOARD_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant', 'role_collection_monitor'];
const COLLECTION_DASHBOARD_ROLES_ = ['role_admin', 'role_finance_admin', 'role_collection_monitor'];

/** بلا startDate/endDate بالطلب → الشهر الحالي بشكل افتراضي */
function defaultDateRange(body) {
  const now = new Date();
  const startDate = body.startDate || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const endDate = body.endDate || now.toISOString().slice(0, 10);
  return { startDate, endDate };
}

/**
 * يحدّد الفروع المسموح للمستخدم رؤيتها. الأدمن العام وأدمن المالية
 * يريان أي فرع (أو الكل لو ما حدَّد فرعاً). مراقب الفروع يرى فروعه فقط
 * (allBranches بالتوكن). المحاسب يرى فرعه هو فقط. تُرجع null = بلا قيد
 * (كل الفروع)، أو مصفوفة الفروع المسموحة.
 */
function resolveBranchScope(user, requestedBranch) {
  const isFullAccess = user.role === 'role_admin' || user.role === 'role_finance_admin';
  if (isFullAccess) {
    return requestedBranch ? [requestedBranch] : null;
  }
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

/* -------------------- لوحة الإدارة المالية الرئيسية -------------------- */
async function handleGetMainDashboard(req, res) {
  const user = requireAuth(req);
  requireRole(user, DASHBOARD_ROLES_);

  const body = req.body || {};
  const { startDate, endDate } = defaultDateRange(body);
  const branches = resolveBranchScope(user, body.branch);
  const today = new Date().toISOString().slice(0, 10);

  // الفواتير الصادرة بالفترة (الإيراد المُفوتَر)
  let invoicesQuery = supabaseAdmin
    .from('fin_invoices')
    .select('id, branch, total_amount')
    .neq('status', 'void')
    .gte('issue_date', startDate)
    .lte('issue_date', endDate);
  invoicesQuery = applyBranchFilter(invoicesQuery, branches);
  const { data: invoices, error: invError } = await invoicesQuery;
  if (invError) throw invError;

  // كل الفواتير غير المسدَّدة حالياً (بلا قيد فترة) — للمستحقات والمتأخرات الفعلية لحظياً
  let openInvoicesQuery = supabaseAdmin
    .from('fin_invoices')
    .select('id, branch, total_amount, paid_amount, due_date')
    .in('status', ['unpaid', 'partially_paid']);
  openInvoicesQuery = applyBranchFilter(openInvoicesQuery, branches);
  const { data: openInvoices, error: openInvError } = await openInvoicesQuery;
  if (openInvError) throw openInvError;

  // الدفعات المؤكَّدة بالفترة
  let paymentsQuery = supabaseAdmin
    .from('fin_payments')
    .select('id, branch, amount')
    .eq('status', 'confirmed')
    .gte('payment_date', startDate)
    .lte('payment_date', endDate);
  paymentsQuery = applyBranchFilter(paymentsQuery, branches);
  const { data: payments, error: payError } = await paymentsQuery;
  if (payError) throw payError;

  // دفعات اليوم فقط
  let todayPaymentsQuery = supabaseAdmin.from('fin_payments').select('amount').eq('status', 'confirmed').eq('payment_date', today);
  todayPaymentsQuery = applyBranchFilter(todayPaymentsQuery, branches);
  const { data: todayPayments, error: todayPayError } = await todayPaymentsQuery;
  if (todayPayError) throw todayPayError;

  // الإيرادات الأخرى بالفترة
  let revenuesQuery = supabaseAdmin.from('fin_revenues').select('amount, branch').gte('revenue_date', startDate).lte('revenue_date', endDate);
  revenuesQuery = applyBranchFilter(revenuesQuery, branches);
  const { data: revenues, error: revError } = await revenuesQuery;
  if (revError) throw revError;

  // المصروفات المعتمدة/المدفوعة بالفترة
  let expensesQuery = supabaseAdmin
    .from('fin_expenses')
    .select('amount, branch')
    .in('status', ['approved', 'paid'])
    .gte('expense_date', startDate)
    .lte('expense_date', endDate);
  expensesQuery = applyBranchFilter(expensesQuery, branches);
  const { data: expenses, error: expError } = await expensesQuery;
  if (expError) throw expError;

  // تنبيه: مصروفات بانتظار الاعتماد
  let pendingExpensesQuery = supabaseAdmin.from('fin_expenses').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  pendingExpensesQuery = applyBranchFilter(pendingExpensesQuery, branches);
  const { count: pendingExpensesCount } = await pendingExpensesQuery;

  // تنبيه: فروقات مطابقة قيد المراجعة
  let reconciliationQuery = supabaseAdmin.from('fin_branch_reconciliation').select('id', { count: 'exact', head: true }).in('status', ['deficit_review', 'surplus_review', 'under_review']);
  reconciliationQuery = applyBranchFilter(reconciliationQuery, branches);
  const { count: openReconciliationCount } = await reconciliationQuery;

  const invoicedTotal = invoices.reduce((s, i) => s + Number(i.total_amount), 0);
  const revenuesTotal = revenues.reduce((s, r) => s + Number(r.amount), 0);
  const totalRevenue = invoicedTotal + revenuesTotal;
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalCollection = payments.reduce((s, p) => s + Number(p.amount), 0);
  const todayCollection = todayPayments.reduce((s, p) => s + Number(p.amount), 0);

  const outstandingAmount = openInvoices.reduce((s, i) => s + (Number(i.total_amount) - Number(i.paid_amount)), 0);
  const overdueInvoices = openInvoices.filter((i) => i.due_date && i.due_date < today);
  const overdueAmount = overdueInvoices.reduce((s, i) => s + (Number(i.total_amount) - Number(i.paid_amount)), 0);

  // آخر العمليات المالية (أحدث 10 دفعات مؤكَّدة)
  let recentPaymentsQuery = supabaseAdmin
    .from('fin_payments')
    .select('id, payment_number, branch, amount, payment_date, created_at')
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(10);
  recentPaymentsQuery = applyBranchFilter(recentPaymentsQuery, branches);
  const { data: recentPayments } = await recentPaymentsQuery;

  return res.status(200).json({
    success: true,
    data: {
      period: { startDate, endDate },
      kpis: {
        totalRevenue,
        totalExpenses,
        netIncome: totalRevenue - totalExpenses,
        totalCollection,
        todayCollection,
        outstandingAmount,
        overdueAmount,
        dueInvoicesCount: openInvoices.length,
        overdueInvoicesCount: overdueInvoices.length,
      },
      alerts: {
        pendingExpensesApproval: pendingExpensesCount || 0,
        openReconciliationDifferences: openReconciliationCount || 0,
        overdueInvoicesCount: overdueInvoices.length,
      },
      recentTransactions: (recentPayments || []).map((p) => ({
        type: 'payment', id: p.id, reference: p.payment_number, branch: p.branch, amount: p.amount, date: p.payment_date,
      })),
    },
  });
}

/* -------------------- لوحة الرقابة والتحصيل (مراقب الفروع والتحصيل) -------------------- */
async function handleGetCollectionDashboard(req, res) {
  const user = requireAuth(req);
  requireRole(user, COLLECTION_DASHBOARD_ROLES_);

  const body = req.body || {};
  const { startDate, endDate } = defaultDateRange(body);
  const branches = resolveBranchScope(user, body.branch);
  const today = new Date().toISOString().slice(0, 10);
  const periodId = body.periodId || null;

  let todayPaymentsQuery = supabaseAdmin.from('fin_payments').select('amount').eq('status', 'confirmed').eq('payment_date', today);
  todayPaymentsQuery = applyBranchFilter(todayPaymentsQuery, branches);
  const { data: todayPayments } = await todayPaymentsQuery;

  let periodPaymentsQuery = supabaseAdmin.from('fin_payments').select('amount, branch').eq('status', 'confirmed').gte('payment_date', startDate).lte('payment_date', endDate);
  periodPaymentsQuery = applyBranchFilter(periodPaymentsQuery, branches);
  const { data: periodPayments } = await periodPaymentsQuery;

  const todayCollection = (todayPayments || []).reduce((s, p) => s + Number(p.amount), 0);
  const periodCollection = (periodPayments || []).reduce((s, p) => s + Number(p.amount), 0);

  // بيانات المطابقة (المتوقع/المستلم/الفروقات) تُقرأ فقط لو حُدِّدت فترة مالية معتمدة (period_id)
  // — قبل ذلك لا يوجد "متوقع" رسمي مُعتمَد بعد (يُبنى بملف reconciliation.js لاحقاً)
  let branchStatusList = [];
  let expectedTotal = 0, receivedTotal = 0, matchedCount = 0, deficitCount = 0, surplusCount = 0, reviewCount = 0;

  if (periodId) {
    let reconQuery = supabaseAdmin.from('fin_branch_reconciliation').select('*').eq('period_id', periodId);
    reconQuery = applyBranchFilter(reconQuery, branches);
    const { data: reconRows, error: reconError } = await reconQuery;
    if (reconError) throw reconError;

    branchStatusList = (reconRows || []).map((r) => ({
      branch: r.branch,
      expected: Number(r.expected_amount),
      received: Number(r.received_amount),
      difference: Number(r.difference_amount),
      status: r.status,
    }));
    expectedTotal = branchStatusList.reduce((s, r) => s + r.expected, 0);
    receivedTotal = branchStatusList.reduce((s, r) => s + r.received, 0);
    matchedCount = branchStatusList.filter((r) => r.status === 'matched' || r.status === 'approved').length;
    deficitCount = branchStatusList.filter((r) => r.status === 'deficit_review').length;
    surplusCount = branchStatusList.filter((r) => r.status === 'surplus_review').length;
    reviewCount = branchStatusList.filter((r) => r.status === 'under_review').length;
  }

  return res.status(200).json({
    success: true,
    data: {
      period: { startDate, endDate, periodId },
      todayCollection,
      periodCollection,
      expectedTotal,
      receivedTotal,
      differenceTotal: receivedTotal - expectedTotal,
      branchesCount: branchStatusList.length,
      matchedCount,
      deficitCount,
      surplusCount,
      reviewCount,
      branchStatusList,
    },
  });
}

export default createRouter({
  getMainDashboard: handleGetMainDashboard,
  getCollectionDashboard: handleGetCollectionDashboard,
});
