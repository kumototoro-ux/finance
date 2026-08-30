// api/payroll.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: listSalaryProfiles, setSalaryProfile, listRuns, getRun,
//           createRun, updateRunItem, approveRun, markRunPaid
//
// ⚠️ الرواتب تشمل كل موظفي المدرسة (كل الأدوار: معلمين، إداريين،
// موظفي مالية...) — تُقرَأ قائمة الموظفين من جدول employees المركزي
// مباشرة بلا أي تمييز بالدور، خلافاً لملف finance-staff.js الذي يخص
// موظفي المالية فقط.
//
// دورة حالة الدفعة: draft (قابلة للتعديل) → approved (مُقفَلة، جاهزة
// للصرف) → paid (صُرفت فعلياً).
// =====================================================================

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import {
  validateBody, setSalaryProfileSchema, createPayrollRunSchema,
  payrollRunIdSchema, updatePayrollItemSchema,
} from '../lib/validation.js';

const VIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant'];
const MANAGE_ROLES_ = ['role_admin', 'role_finance_admin'];

async function writeAudit(user, action, details, entity, entityId) {
  await supabaseAdmin.from('audit_log').insert({
    emp_id: user.id, emp_name: user.fullName, role: user.role,
    action, details, branch: user.branch, entity, entity_id: entityId || null, result: 'success',
  });
}

/* -------------------- ملفات رواتب الموظفين (القيم الافتراضية الشهرية) -------------------- */
async function handleListSalaryProfiles(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};

  let query = supabaseAdmin.from('employees').select('id, name_ar, role, branch, fin_employee_salary_profile!fin_employee_salary_profile_employee_id_fkey(base_salary, default_allowances, default_deductions, updated_at)').is('deleted_at', null).order('name_ar');
  if (body.branch) query = query.eq('branch', body.branch);

  const { data, error } = await query;
  if (error) throw error;

  const result = (data || []).map((e) => ({
    id: e.id, nameAr: e.name_ar, role: e.role, branch: e.branch,
    baseSalary: Number(e.fin_employee_salary_profile?.base_salary || 0),
    defaultAllowances: Number(e.fin_employee_salary_profile?.default_allowances || 0),
    defaultDeductions: Number(e.fin_employee_salary_profile?.default_deductions || 0),
    hasProfile: !!e.fin_employee_salary_profile,
  }));
  return res.status(200).json({ success: true, data: result });
}

async function handleSetSalaryProfile(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const d = validateBody(setSalaryProfileSchema, req.body);

  const { data: employee } = await supabaseAdmin.from('employees').select('id').eq('id', d.employeeId).is('deleted_at', null).maybeSingle();
  if (!employee) {
    const err = new Error('الموظف غير موجود');
    err.statusCode = 404;
    throw err;
  }

  const { error } = await supabaseAdmin.from('fin_employee_salary_profile').upsert({
    employee_id: d.employeeId, base_salary: d.baseSalary, default_allowances: d.defaultAllowances,
    default_deductions: d.defaultDeductions, updated_by: user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'employee_id' });
  if (error) throw error;

  await writeAudit(user, 'تحديث ملف راتب موظف', { employeeId: d.employeeId, baseSalary: d.baseSalary }, 'fin_employee_salary_profile', d.employeeId);
  return res.status(200).json({ success: true, data: true });
}

/* -------------------- دورات الرواتب -------------------- */
async function handleListRuns(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};

  let query = supabaseAdmin.from('fin_payroll_runs').select('*').order('pay_month', { ascending: false });
  if (body.branch) query = query.eq('branch', body.branch);
  if (body.status) query = query.eq('status', body.status);

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

async function handleGetRun(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const { runId } = validateBody(payrollRunIdSchema, req.body);

  const { data: run, error: runError } = await supabaseAdmin.from('fin_payroll_runs').select('*').eq('id', runId).maybeSingle();
  if (runError) throw runError;
  if (!run) {
    const err = new Error('دورة الرواتب غير موجودة');
    err.statusCode = 404;
    throw err;
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('fin_payroll_items').select('*, employees(name_ar, role, branch)').eq('payroll_run_id', runId).order('id');
  if (itemsError) throw itemsError;

  const enrichedItems = (items || []).map((i) => ({
    id: i.id, employeeId: i.employee_id, employeeName: i.employees?.name_ar, employeeRole: i.employees?.role, employeeBranch: i.employees?.branch,
    baseSalary: Number(i.base_salary), allowances: Number(i.allowances), deductions: Number(i.deductions),
    netSalary: Number(i.net_salary), notes: i.notes, paidAt: i.paid_at,
  }));
  const totalNet = enrichedItems.reduce((s, i) => s + i.netSalary, 0);

  return res.status(200).json({ success: true, data: { run, items: enrichedItems, totalNet } });
}

/** إنشاء دورة رواتب جديدة — تسحب كل الموظفين النشطين بالفرع (أو كل الفروع) وتبني بنوداً من ملفات رواتبهم الافتراضية */
async function handleCreateRun(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const d = validateBody(createPayrollRunSchema, req.body);

  let employeesQuery = supabaseAdmin.from('employees').select('id, fin_employee_salary_profile!fin_employee_salary_profile_employee_id_fkey(base_salary, default_allowances, default_deductions)').is('deleted_at', null);
  if (d.branch) employeesQuery = employeesQuery.eq('branch', d.branch);
  const { data: employees, error: empError } = await employeesQuery;
  if (empError) throw empError;
  if (!employees || !employees.length) {
    const err = new Error('لا يوجد موظفون نشطون بهذا الفرع لإنشاء دورة رواتب لهم');
    err.statusCode = 400;
    throw err;
  }

  const { data: run, error: runError } = await supabaseAdmin.from('fin_payroll_runs').insert({
    branch: d.branch || null, pay_month: d.payMonth, status: 'draft', created_by: user.id,
  }).select('id').single();
  if (runError) throw runError;

  const itemRows = employees.map((e) => ({
    payroll_run_id: run.id, employee_id: e.id,
    base_salary: Number(e.fin_employee_salary_profile?.base_salary || 0),
    allowances: Number(e.fin_employee_salary_profile?.default_allowances || 0),
    deductions: Number(e.fin_employee_salary_profile?.default_deductions || 0),
  }));
  const { error: itemsError } = await supabaseAdmin.from('fin_payroll_items').insert(itemRows);
  if (itemsError) throw itemsError;

  await writeAudit(user, 'إنشاء دورة رواتب جديدة', { branch: d.branch || 'كل الفروع', payMonth: d.payMonth, employeesCount: employees.length }, 'fin_payroll_runs', run.id);
  return res.status(200).json({ success: true, data: { id: run.id, employeesCount: employees.length } });
}

/** تعديل بند راتب موظف واحد ضمن دورة لسه Draft */
async function handleUpdateRunItem(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const d = validateBody(updatePayrollItemSchema, req.body);

  const { data: item, error: findError } = await supabaseAdmin.from('fin_payroll_items').select('*, fin_payroll_runs(status)').eq('id', d.itemId).maybeSingle();
  if (findError) throw findError;
  if (!item) {
    const err = new Error('بند الراتب غير موجود');
    err.statusCode = 404;
    throw err;
  }
  if (item.fin_payroll_runs?.status !== 'draft') {
    const err = new Error('لا يمكن تعديل بنود دورة رواتب بعد اعتمادها');
    err.statusCode = 403;
    throw err;
  }

  const updatePayload = {};
  if (d.baseSalary !== undefined) updatePayload.base_salary = d.baseSalary;
  if (d.allowances !== undefined) updatePayload.allowances = d.allowances;
  if (d.deductions !== undefined) updatePayload.deductions = d.deductions;
  if (d.notes !== undefined) updatePayload.notes = d.notes || null;

  const { error } = await supabaseAdmin.from('fin_payroll_items').update(updatePayload).eq('id', d.itemId);
  if (error) throw error;

  await writeAudit(user, 'تعديل بند راتب ضمن دورة', { itemId: d.itemId, employeeId: item.employee_id, changes: updatePayload }, 'fin_payroll_items', d.itemId);
  return res.status(200).json({ success: true, data: true });
}

/* -------------------- اعتماد دورة الرواتب -------------------- */
async function handleApproveRun(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const { runId } = validateBody(payrollRunIdSchema, req.body);

  const { data: run, error: findError } = await supabaseAdmin.from('fin_payroll_runs').select('*').eq('id', runId).maybeSingle();
  if (findError) throw findError;
  if (!run) {
    const err = new Error('دورة الرواتب غير موجودة');
    err.statusCode = 404;
    throw err;
  }
  if (run.status !== 'draft') {
    const err = new Error('لا يمكن اعتماد دورة إلا وهي بحالة مسودة');
    err.statusCode = 409;
    throw err;
  }

  const { error } = await supabaseAdmin.from('fin_payroll_runs').update({
    status: 'approved', approved_by: user.id, approved_at: new Date().toISOString(),
  }).eq('id', runId);
  if (error) throw error;

  await writeAudit(user, 'اعتماد دورة رواتب', { branch: run.branch || 'كل الفروع', payMonth: run.pay_month }, 'fin_payroll_runs', run.id);
  return res.status(200).json({ success: true, data: true });
}

/* -------------------- تمييز دورة كامل كمصروفة -------------------- */
async function handleMarkRunPaid(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_ROLES_);
  const { runId } = validateBody(payrollRunIdSchema, req.body);

  const { data: run, error: findError } = await supabaseAdmin.from('fin_payroll_runs').select('*').eq('id', runId).maybeSingle();
  if (findError) throw findError;
  if (!run) {
    const err = new Error('دورة الرواتب غير موجودة');
    err.statusCode = 404;
    throw err;
  }
  if (run.status !== 'approved') {
    const err = new Error('لا يمكن تمييز دورة كمصروفة إلا بعد اعتمادها أولاً');
    err.statusCode = 409;
    throw err;
  }

  const now = new Date().toISOString();
  const { error: runUpdateError } = await supabaseAdmin.from('fin_payroll_runs').update({ status: 'paid' }).eq('id', runId);
  if (runUpdateError) throw runUpdateError;
  const { error: itemsUpdateError } = await supabaseAdmin.from('fin_payroll_items').update({ paid_at: now }).eq('payroll_run_id', runId);
  if (itemsUpdateError) throw itemsUpdateError;

  await writeAudit(user, 'صرف دورة رواتب كاملة', { branch: run.branch || 'كل الفروع', payMonth: run.pay_month }, 'fin_payroll_runs', run.id);
  return res.status(200).json({ success: true, data: true });
}

export default createRouter({
  listSalaryProfiles: handleListSalaryProfiles,
  setSalaryProfile: handleSetSalaryProfile,
  listRuns: handleListRuns,
  getRun: handleGetRun,
  createRun: handleCreateRun,
  updateRunItem: handleUpdateRunItem,
  approveRun: handleApproveRun,
  markRunPaid: handleMarkRunPaid,
});
