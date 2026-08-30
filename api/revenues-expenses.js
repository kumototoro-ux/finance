// api/revenues-expenses.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات:
//   الإيرادات: listRevenues, addRevenue, voidRevenue
//   المصروفات: listExpenses, addExpense, approveExpense, rejectExpense,
//              markExpensePaid, voidExpense
//   التقارير:  getIncomeStatement, reportExpensesByCategory, reportCashFlow
//
// دورة حالة المصروف: pending → approved → paid (أو rejected من pending)
// أي حالة عدا pending يمكن إلغاؤها (void) بصلاحية خاصة مع سبب إلزامي.
// =====================================================================

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import {
  validateBody, addRevenueSchema, voidRevenueSchema,
  addExpenseSchema, expenseIdSchema, rejectExpenseSchema, voidExpenseSchema,
} from '../lib/validation.js';

const VIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant'];
const RECORD_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant'];
const APPROVE_ROLES_ = ['role_admin', 'role_finance_admin'];

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

function sum(list, mapper) { return list.reduce((s, item) => s + mapper(item), 0); }

async function writeAudit(user, action, details, entity, entityId) {
  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action, details, branch: user.branch, entity, entity_id: entityId || null, result: 'success',
  });
}

/* ===================== الإيرادات الأخرى ===================== */

async function handleListRevenues(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin.from('fin_revenues').select('*').order('revenue_date', { ascending: false }).limit(500);
  query = applyBranchFilter(query, branches);
  if (!body.includeVoid) query = query.eq('status', 'confirmed');
  if (body.dateFrom) query = query.gte('revenue_date', body.dateFrom);
  if (body.dateTo) query = query.lte('revenue_date', body.dateTo);
  if (body.category) query = query.eq('category', body.category);

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

async function handleAddRevenue(req, res) {
  const user = requireAuth(req);
  requireRole(user, RECORD_ROLES_);
  const d = validateBody(addRevenueSchema, req.body);

  const allowed = resolveBranchScope(user, d.branch);
  if (allowed && !allowed.includes(d.branch)) {
    const err = new Error('غير مصرَّح لك بهذا الفرع');
    err.statusCode = 403;
    throw err;
  }

  const { data, error } = await supabaseAdmin.from('fin_revenues').insert({
    branch: d.branch, account_id: d.accountId || null, category: d.category, amount: d.amount,
    revenue_date: d.revenueDate || new Date().toISOString().slice(0, 10),
    academic_year: d.academicYear || null, term_id: d.termId || null,
    description: d.description || null, recorded_by: user.id,
  }).select('id').single();
  if (error) throw error;

  await writeAudit(user, 'تسجيل إيراد جديد', { category: d.category, amount: d.amount, branch: d.branch }, 'fin_revenues', data.id);
  return res.status(200).json({ success: true, data: { id: data.id } });
}

async function handleVoidRevenue(req, res) {
  const user = requireAuth(req);
  requireRole(user, APPROVE_ROLES_);
  const d = validateBody(voidRevenueSchema, req.body);

  const { data: revenue, error: findError } = await supabaseAdmin.from('fin_revenues').select('*').eq('id', d.revenueId).maybeSingle();
  if (findError) throw findError;
  if (!revenue) { const err = new Error('الإيراد غير موجود'); err.statusCode = 404; throw err; }
  if (revenue.status === 'void') { const err = new Error('هذا الإيراد مُلغى بالفعل'); err.statusCode = 409; throw err; }

  const { error } = await supabaseAdmin.from('fin_revenues').update({
    status: 'void', voided_by: user.id, voided_at: new Date().toISOString(), void_reason: d.reason,
  }).eq('id', d.revenueId);
  if (error) throw error;

  await writeAudit(user, 'إلغاء إيراد', { category: revenue.category, amount: revenue.amount, reason: d.reason }, 'fin_revenues', revenue.id);
  return res.status(200).json({ success: true, data: true });
}

/* ===================== المصروفات ===================== */

async function handleListExpenses(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin.from('fin_expenses').select('*, fin_expense_categories(name)').order('expense_date', { ascending: false }).limit(500);
  query = applyBranchFilter(query, branches);
  if (body.status) query = query.eq('status', body.status);
  if (body.expenseCategoryId) query = query.eq('expense_category_id', body.expenseCategoryId);
  if (body.dateFrom) query = query.gte('expense_date', body.dateFrom);
  if (body.dateTo) query = query.lte('expense_date', body.dateTo);

  const { data, error } = await query;
  if (error) throw error;

  const result = (data || []).map((e) => ({ ...e, categoryName: e.fin_expense_categories?.name || null, fin_expense_categories: undefined }));
  return res.status(200).json({ success: true, data: result });
}

async function handleAddExpense(req, res) {
  const user = requireAuth(req);
  requireRole(user, RECORD_ROLES_);
  const d = validateBody(addExpenseSchema, req.body);

  const allowed = resolveBranchScope(user, d.branch);
  if (allowed && !allowed.includes(d.branch)) {
    const err = new Error('غير مصرَّح لك بهذا الفرع');
    err.statusCode = 403;
    throw err;
  }

  const { data, error } = await supabaseAdmin.from('fin_expenses').insert({
    expense_category_id: d.expenseCategoryId, branch: d.branch, account_id: d.accountId || null,
    beneficiary: d.beneficiary || null, amount: d.amount, expense_date: d.expenseDate || new Date().toISOString().slice(0, 10),
    description: d.description || null, attachments: d.attachments && d.attachments.length ? d.attachments : null,
    status: 'pending', requested_by: user.id,
  }).select('id').single();
  if (error) throw error;

  await writeAudit(user, 'طلب تسجيل مصروف جديد', { amount: d.amount, branch: d.branch }, 'fin_expenses', data.id);
  return res.status(200).json({ success: true, data: { id: data.id } });
}

async function handleApproveExpense(req, res) {
  const user = requireAuth(req);
  requireRole(user, APPROVE_ROLES_);
  const { expenseId } = validateBody(expenseIdSchema, req.body);

  const { data: expense, error: findError } = await supabaseAdmin.from('fin_expenses').select('*').eq('id', expenseId).maybeSingle();
  if (findError) throw findError;
  if (!expense) { const err = new Error('المصروف غير موجود'); err.statusCode = 404; throw err; }
  if (expense.status !== 'pending') { const err = new Error('لا يمكن اعتماد مصروف إلا وهو بانتظار الاعتماد'); err.statusCode = 409; throw err; }

  const { error } = await supabaseAdmin.from('fin_expenses').update({
    status: 'approved', approved_by: user.id, approved_at: new Date().toISOString(),
  }).eq('id', expenseId);
  if (error) throw error;

  await writeAudit(user, 'اعتماد مصروف', { amount: expense.amount, branch: expense.branch }, 'fin_expenses', expense.id);
  return res.status(200).json({ success: true, data: true });
}

async function handleRejectExpense(req, res) {
  const user = requireAuth(req);
  requireRole(user, APPROVE_ROLES_);
  const d = validateBody(rejectExpenseSchema, req.body);

  const { data: expense, error: findError } = await supabaseAdmin.from('fin_expenses').select('*').eq('id', d.expenseId).maybeSingle();
  if (findError) throw findError;
  if (!expense) { const err = new Error('المصروف غير موجود'); err.statusCode = 404; throw err; }
  if (expense.status !== 'pending') { const err = new Error('لا يمكن رفض مصروف إلا وهو بانتظار الاعتماد'); err.statusCode = 409; throw err; }

  const { error } = await supabaseAdmin.from('fin_expenses').update({
    status: 'rejected', approved_by: user.id, approved_at: new Date().toISOString(), description: expense.description ? `${expense.description}\n[سبب الرفض]: ${d.reason}` : `[سبب الرفض]: ${d.reason}`,
  }).eq('id', d.expenseId);
  if (error) throw error;

  await writeAudit(user, 'رفض مصروف', { amount: expense.amount, reason: d.reason }, 'fin_expenses', expense.id);
  return res.status(200).json({ success: true, data: true });
}

async function handleMarkExpensePaid(req, res) {
  const user = requireAuth(req);
  requireRole(user, APPROVE_ROLES_);
  const { expenseId } = validateBody(expenseIdSchema, req.body);

  const { data: expense, error: findError } = await supabaseAdmin.from('fin_expenses').select('*').eq('id', expenseId).maybeSingle();
  if (findError) throw findError;
  if (!expense) { const err = new Error('المصروف غير موجود'); err.statusCode = 404; throw err; }
  if (expense.status !== 'approved') { const err = new Error('لا يمكن تمييز مصروف كمدفوع إلا بعد اعتماده أولاً'); err.statusCode = 409; throw err; }

  const { error } = await supabaseAdmin.from('fin_expenses').update({ status: 'paid' }).eq('id', expenseId);
  if (error) throw error;

  await writeAudit(user, 'تمييز مصروف كمدفوع', { amount: expense.amount, branch: expense.branch }, 'fin_expenses', expense.id);
  return res.status(200).json({ success: true, data: true });
}

async function handleVoidExpense(req, res) {
  const user = requireAuth(req);
  requireRole(user, APPROVE_ROLES_);
  const d = validateBody(voidExpenseSchema, req.body);

  const { data: expense, error: findError } = await supabaseAdmin.from('fin_expenses').select('*').eq('id', d.expenseId).maybeSingle();
  if (findError) throw findError;
  if (!expense) { const err = new Error('المصروف غير موجود'); err.statusCode = 404; throw err; }
  if (expense.status === 'void') { const err = new Error('هذا المصروف مُلغى بالفعل'); err.statusCode = 409; throw err; }
  if (expense.status === 'pending') { const err = new Error('استخدم الرفض بدل الإلغاء لمصروف لسه بانتظار الاعتماد'); err.statusCode = 400; throw err; }

  const { error } = await supabaseAdmin.from('fin_expenses').update({
    status: 'void', voided_by: user.id, voided_at: new Date().toISOString(), void_reason: d.reason,
  }).eq('id', d.expenseId);
  if (error) throw error;

  await writeAudit(user, 'إلغاء مصروف (بعد الاعتماد/الدفع)', { amount: expense.amount, previousStatus: expense.status, reason: d.reason }, 'fin_expenses', expense.id);
  return res.status(200).json({ success: true, data: true });
}

/* ===================== التقارير ===================== */

async function handleGetIncomeStatement(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);
  const startDate = body.startDate;
  const endDate = body.endDate;
  if (!startDate || !endDate) { const err = new Error('يجب تحديد الفترة (startDate و endDate)'); err.statusCode = 400; throw err; }

  let invoicesQuery = supabaseAdmin.from('fin_invoices').select('total_amount').neq('status', 'void').gte('issue_date', startDate).lte('issue_date', endDate);
  invoicesQuery = applyBranchFilter(invoicesQuery, branches);
  let revenuesQuery = supabaseAdmin.from('fin_revenues').select('amount, category').eq('status', 'confirmed').gte('revenue_date', startDate).lte('revenue_date', endDate);
  revenuesQuery = applyBranchFilter(revenuesQuery, branches);
  let expensesQuery = supabaseAdmin.from('fin_expenses').select('amount, expense_category_id, fin_expense_categories(name)').in('status', ['approved', 'paid']).gte('expense_date', startDate).lte('expense_date', endDate);
  expensesQuery = applyBranchFilter(expensesQuery, branches);

  const [{ data: invoices, error: invError }, { data: revenues, error: revError }, { data: expenses, error: expError }] = await Promise.all([invoicesQuery, revenuesQuery, expensesQuery]);
  if (invError) throw invError;
  if (revError) throw revError;
  if (expError) throw expError;

  const feesRevenue = sum(invoices || [], (i) => Number(i.total_amount));
  const otherRevenue = sum(revenues || [], (r) => Number(r.amount));
  const totalRevenue = feesRevenue + otherRevenue;
  const totalExpenses = sum(expenses || [], (e) => Number(e.amount));

  const expensesByCategory = {};
  (expenses || []).forEach((e) => {
    const name = e.fin_expense_categories?.name || 'غير مصنَّف';
    expensesByCategory[name] = (expensesByCategory[name] || 0) + Number(e.amount);
  });

  return res.status(200).json({
    success: true,
    data: {
      period: { startDate, endDate },
      revenue: { feesRevenue, otherRevenue, totalRevenue },
      expenses: { totalExpenses, byCategory: Object.entries(expensesByCategory).map(([category, amount]) => ({ category, amount })) },
      netIncome: totalRevenue - totalExpenses,
    },
  });
}

async function handleReportExpensesByCategory(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin.from('fin_expenses').select('amount, fin_expense_categories(name)').in('status', ['approved', 'paid']);
  query = applyBranchFilter(query, branches);
  if (body.dateFrom) query = query.gte('expense_date', body.dateFrom);
  if (body.dateTo) query = query.lte('expense_date', body.dateTo);

  const { data, error } = await query;
  if (error) throw error;

  const byCategory = {};
  (data || []).forEach((e) => {
    const name = e.fin_expense_categories?.name || 'غير مصنَّف';
    byCategory[name] = (byCategory[name] || 0) + Number(e.amount);
  });

  return res.status(200).json({ success: true, data: Object.entries(byCategory).map(([category, amount]) => ({ category, amount })) });
}

async function handleReportCashFlow(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);
  const startDate = body.startDate;
  const endDate = body.endDate;
  if (!startDate || !endDate) { const err = new Error('يجب تحديد الفترة (startDate و endDate)'); err.statusCode = 400; throw err; }

  let paymentsQuery = supabaseAdmin.from('fin_payments').select('amount, payment_date').eq('status', 'confirmed').gte('payment_date', startDate).lte('payment_date', endDate);
  paymentsQuery = applyBranchFilter(paymentsQuery, branches);
  let revenuesQuery = supabaseAdmin.from('fin_revenues').select('amount, revenue_date').eq('status', 'confirmed').gte('revenue_date', startDate).lte('revenue_date', endDate);
  revenuesQuery = applyBranchFilter(revenuesQuery, branches);
  let expensesQuery = supabaseAdmin.from('fin_expenses').select('amount, expense_date').eq('status', 'paid').gte('expense_date', startDate).lte('expense_date', endDate);
  expensesQuery = applyBranchFilter(expensesQuery, branches);

  const [{ data: payments }, { data: revenues }, { data: expenses }] = await Promise.all([paymentsQuery, revenuesQuery, expensesQuery]);

  const byDate = {};
  (payments || []).forEach((p) => { byDate[p.payment_date] = byDate[p.payment_date] || { cashIn: 0, cashOut: 0 }; byDate[p.payment_date].cashIn += Number(p.amount); });
  (revenues || []).forEach((r) => { byDate[r.revenue_date] = byDate[r.revenue_date] || { cashIn: 0, cashOut: 0 }; byDate[r.revenue_date].cashIn += Number(r.amount); });
  (expenses || []).forEach((e) => { byDate[e.expense_date] = byDate[e.expense_date] || { cashIn: 0, cashOut: 0 }; byDate[e.expense_date].cashOut += Number(e.amount); });

  let runningBalance = 0;
  const days = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => {
    runningBalance += v.cashIn - v.cashOut;
    return { date, cashIn: v.cashIn, cashOut: v.cashOut, netChange: v.cashIn - v.cashOut, runningBalance };
  });

  return res.status(200).json({ success: true, data: { period: { startDate, endDate }, days, closingBalance: runningBalance } });
}

export default createRouter({
  listRevenues: handleListRevenues,
  addRevenue: handleAddRevenue,
  voidRevenue: handleVoidRevenue,

  listExpenses: handleListExpenses,
  addExpense: handleAddExpense,
  approveExpense: handleApproveExpense,
  rejectExpense: handleRejectExpense,
  markExpensePaid: handleMarkExpensePaid,
  voidExpense: handleVoidExpense,

  getIncomeStatement: handleGetIncomeStatement,
  reportExpensesByCategory: handleReportExpensesByCategory,
  reportCashFlow: handleReportCashFlow,
});
