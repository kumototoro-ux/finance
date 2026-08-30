// api/invoices.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: list, get, issue, void, reportDue
//
// ⚠️ الفاتورة تخزّن نسخة (snapshot) من المبلغ وقت الإصدار — تعديل
// fin_fee_structure لاحقاً لا يغيّر أي فاتورة صادرة فعلاً إطلاقاً.
//
// ⚠️ لا يوجد Trigger بقاعدة البيانات يُعيد حساب الحالة المالية للطالب
// عند إصدار/إلغاء فاتورة (الـTrigger الوحيد مربوط بجدول الدفعات فقط) —
// لذلك هذا الملف يستدعي دالة fin_recalc_student_clearance يدوياً عبر
// RPC بعد كل إصدار أو إلغاء، حتى تبقى الحالة المالية محدَّثة لحظياً.
// =====================================================================

import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import { validateBody, issueInvoiceSchema, voidInvoiceSchema } from '../lib/validation.js';
import { generateInvoiceNumber } from '../lib/idGenerator.js';

const VIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant', 'role_collection_monitor'];
const ISSUE_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant'];
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
    action, details, branch: user.branch, entity: 'fin_invoices', entity_id: entityId || null, result: 'success',
  });
}

async function recalcClearance(studentId, academicYear, termId) {
  const { error } = await supabaseAdmin.rpc('fin_recalc_student_clearance', {
    p_student_id: studentId, p_academic_year: academicYear, p_term_id: termId,
  });
  if (error) throw error;
}

/* -------------------- قائمة الفواتير -------------------- */
async function handleList(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin
    .from('fin_invoices')
    .select('id, invoice_number, student_id, branch, grade, section, academic_year, term_id, issue_date, due_date, subtotal_amount, discount_amount, tax_amount, total_amount, paid_amount, status, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  query = applyBranchFilter(query, branches);
  if (body.studentId) query = query.eq('student_id', body.studentId);
  if (body.status) query = query.eq('status', body.status);
  if (body.academicYear) query = query.eq('academic_year', body.academicYear);
  if (body.termId) query = query.eq('term_id', body.termId);

  const { data, error } = await query;
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

/* -------------------- تفاصيل فاتورة واحدة (مع بنودها) -------------------- */
async function handleGet(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const { invoiceId } = validateBody(z.object({ invoiceId: z.union([z.string(), z.number()]) }), req.body);

  const { data: invoice, error: invError } = await supabaseAdmin.from('fin_invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (invError) throw invError;
  if (!invoice) {
    const err = new Error('الفاتورة غير موجودة');
    err.statusCode = 404;
    throw err;
  }

  const allowed = resolveBranchScope(user, null);
  if (allowed && !allowed.includes(invoice.branch)) {
    const err = new Error('غير مصرَّح لك بفرع هذه الفاتورة');
    err.statusCode = 403;
    throw err;
  }

  const { data: items, error: itemsError } = await supabaseAdmin.from('fin_invoice_items').select('*').eq('invoice_id', invoiceId);
  if (itemsError) throw itemsError;

  const { data: payments } = await supabaseAdmin.from('fin_payments').select('id, payment_number, amount, payment_date, status').eq('invoice_id', invoiceId).order('payment_date');

  return res.status(200).json({ success: true, data: { invoice, items: items || [], payments: payments || [] } });
}

/* -------------------- إصدار فاتورة جديدة -------------------- */
async function handleIssue(req, res) {
  const user = requireAuth(req);
  requireRole(user, ISSUE_ROLES_);
  const d = validateBody(issueInvoiceSchema, req.body);

  const { data: student, error: stuError } = await supabaseAdmin
    .from('students').select('id, branch, stage, grade, section').eq('id', d.studentId).is('deleted_at', null).maybeSingle();
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

  // بناء البنود: إمّا تلقائياً من هيكل الرسوم المعتمد، أو يدوياً كما أُرسِل
  let items;
  if (d.useFeeStructure) {
    const { data: structureRows, error: structError } = await supabaseAdmin
      .from('fin_fee_structure')
      .select('id, fee_item_id, amount, fin_fee_items(name)')
      .eq('academic_year', d.academicYear).eq('term_id', d.termId)
      .eq('branch', student.branch).eq('grade', student.grade).eq('is_active', true);
    if (structError) throw structError;
    if (!structureRows || !structureRows.length) {
      const err = new Error('لا توجد رسوم دراسية معدَّة لهذا الصف والفرع بهذا العام/الفصل — أضِفها أولاً من إعدادات الرسوم');
      err.statusCode = 400;
      throw err;
    }
    items = structureRows.map((r) => ({
      feeItemId: r.fee_item_id, feeStructureId: r.id, description: r.fin_fee_items?.name || 'رسوم دراسية',
      amount: Number(r.amount), discountAmount: 0,
    }));
  } else {
    items = d.items.map((i) => ({ feeItemId: i.feeItemId || null, feeStructureId: null, description: i.description, amount: i.amount, discountAmount: i.discountAmount || 0 }));
  }

  const itemsSubtotal = items.reduce((s, i) => s + i.amount, 0);
  const itemsDiscount = items.reduce((s, i) => s + i.discountAmount, 0);
  const subtotalAmount = itemsSubtotal;
  const discountAmount = itemsDiscount + d.extraDiscountAmount;
  const taxAmount = d.taxAmount;

  const invoiceNumber = await generateInvoiceNumber(supabaseAdmin);

  const { data: newInvoice, error: insError } = await supabaseAdmin.from('fin_invoices').insert({
    invoice_number: invoiceNumber, student_id: d.studentId,
    branch: student.branch, stage: student.stage, grade: student.grade, section: student.section,
    academic_year: d.academicYear, term_id: d.termId, due_date: d.dueDate || null,
    subtotal_amount: subtotalAmount, discount_amount: discountAmount, tax_amount: taxAmount,
    notes: d.notes || null, created_by: user.id,
  }).select('id, invoice_number').single();
  if (insError) throw insError;

  const itemRows = items.map((i) => ({
    invoice_id: newInvoice.id, fee_item_id: i.feeItemId, fee_structure_id: i.feeStructureId,
    description: i.description, amount: i.amount, discount_amount: i.discountAmount,
  }));
  const { error: itemsInsError } = await supabaseAdmin.from('fin_invoice_items').insert(itemRows);
  if (itemsInsError) throw itemsInsError;

  await recalcClearance(d.studentId, d.academicYear, d.termId);
  await writeAudit(user, 'إصدار فاتورة جديدة', { studentId: d.studentId, invoiceNumber: newInvoice.invoice_number, total: subtotalAmount - discountAmount + taxAmount }, newInvoice.id);

  return res.status(200).json({ success: true, data: { id: newInvoice.id, invoiceNumber: newInvoice.invoice_number } });
}

/* -------------------- إلغاء فاتورة (Void قابل للتتبع، بلا حذف فعلي) -------------------- */
async function handleVoid(req, res) {
  const user = requireAuth(req);
  requireRole(user, VOID_ROLES_);
  const d = validateBody(voidInvoiceSchema, req.body);

  const { data: invoice, error: findError } = await supabaseAdmin.from('fin_invoices').select('*').eq('id', d.invoiceId).maybeSingle();
  if (findError) throw findError;
  if (!invoice) {
    const err = new Error('الفاتورة غير موجودة');
    err.statusCode = 404;
    throw err;
  }
  if (invoice.status === 'void') {
    const err = new Error('هذه الفاتورة مُلغاة بالفعل');
    err.statusCode = 409;
    throw err;
  }

  // ⚠️ فاتورة مرتبطة بفترة مالية مُقفَلة — يُمنَع إلغاؤها بالمسار العادي
  // (بند 8 بمواصفاتك). تفعيل تجاوز هذا القيد يحتاج ملف financial-periods.js
  // القادم لإدارة صلاحية "تعديل بعد الإقفال" بشكل صريح ومُدقَّق.
  if (invoice.period_id) {
    const { data: period } = await supabaseAdmin.from('fin_financial_periods').select('status').eq('id', invoice.period_id).maybeSingle();
    if (period && period.status === 'closed') {
      const err = new Error('هذه الفاتورة ضمن فترة مالية مُقفَلة — لا يمكن إلغاؤها إلا بصلاحية خاصة بعد إعادة فتح الفترة');
      err.statusCode = 403;
      throw err;
    }
  }

  const { error: voidError } = await supabaseAdmin.from('fin_invoices').update({
    status: 'void', voided_by: user.id, voided_at: new Date().toISOString(), void_reason: d.reason,
  }).eq('id', d.invoiceId);
  if (voidError) throw voidError;

  await recalcClearance(invoice.student_id, invoice.academic_year, invoice.term_id);
  await writeAudit(user, 'إلغاء فاتورة', { invoiceNumber: invoice.invoice_number, reason: d.reason }, invoice.id);

  return res.status(200).json({ success: true, data: true });
}

/* -------------------- تقرير الفواتير المستحقة (غير مسدَّدة كلياً، مرتَّبة بتاريخ الاستحقاق) -------------------- */
async function handleReportDue(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);
  const today = new Date().toISOString().slice(0, 10);

  let query = supabaseAdmin
    .from('fin_invoices')
    .select('id, invoice_number, student_id, branch, grade, section, due_date, total_amount, paid_amount, status')
    .in('status', ['unpaid', 'partially_paid'])
    .order('due_date', { ascending: true, nullsFirst: false });
  query = applyBranchFilter(query, branches);
  if (body.academicYear) query = query.eq('academic_year', body.academicYear);
  if (body.termId) query = query.eq('term_id', body.termId);

  const { data, error } = await query;
  if (error) throw error;

  const result = (data || []).map((inv) => ({
    ...inv,
    remainingAmount: Number(inv.total_amount) - Number(inv.paid_amount),
    isOverdue: !!(inv.due_date && inv.due_date < today),
  }));

  return res.status(200).json({ success: true, data: result });
}

export default createRouter({
  list: handleList,
  get: handleGet,
  issue: handleIssue,
  void: handleVoid,
  reportDue: handleReportDue,
});
