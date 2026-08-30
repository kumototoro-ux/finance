// api/students-finance.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// إجراءات: list, getCard, getStatement, generateDues, listDues,
//           setManualStatus, revertToAutomatic, reportOverdue,
//           reportUnpaid, reportExemptions, reportFeesByGradeBranch
//
// ⚠️ تحوّل جوهري: الاستحقاقات (fin_dues) هي مصدر مديونية الطالب الوحيد
// الآن — لا الفواتير. بمجرد فتح البطاقة المالية لطالب، يتحقق النظام
// تلقائياً من الفصل الدراسي الحالي (is_visible=true بموقع الموظفين)
// ويولّد له استحقاقاته من هيكل الرسوم المعتمد لفرعه وصفّه، بلا أي تدخّل
// يدوي من المحاسب إطلاقاً — بالضبط كما طُلب.
//
// ⚠️ لا يكتب هذا الملف أي شيء بجدول students المركزي (بيانات الطالب
// الأساسية مملوكة بالكامل لموقع الموظفين) — قراءة فقط منه، وكل الكتابة
// تنحصر بجداول fin_* الخاصة بالمالية.
// =====================================================================

import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { createRouter } from '../lib/router.js';
import { validateBody, generateDuesSchema, listDuesSchema } from '../lib/validation.js';

const VIEW_ROLES_ = ['role_admin', 'role_finance_admin', 'role_accountant', 'role_collection_monitor'];
const MANAGE_STATUS_ROLES_ = ['role_admin', 'role_finance_admin'];

/** نفس مبدأ resolveBranchScope بملف dashboard.js بالضبط — مكرَّر عمداً (كل ملف مستقل تماماً) */
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
    action, details, branch: user.branch,
    entity: 'fin_student_clearance', entity_id: entityId || null, result: 'success',
  });
}

/**
 * توليد استحقاقات طالب من هيكل الرسوم المعتمد لفرعه وصفّه (بلا تكرار —
 * القيد الفريد بجدول fin_dues يمنع أي ازدواج، ونتجاهل خطأ التكرار
 * 23505 بصمت لأنه يعني ببساطة أن الاستحقاق موجود مسبقاً وسليم).
 * تُستدعى تلقائياً بصمت عند فتح بطاقة أي طالب (الفصل الحالي)، وصراحةً
 * عبر إجراء generateDues لأي عام/فصل آخر (مثل تحضير الفصل القادم مبكراً).
 */
async function generateDuesForStudent(studentId, branch, grade, academicYear, termId, user) {
  const { data: structureRows, error: structError } = await supabaseAdmin
    .from('fin_fee_structure')
    .select('id, fee_item_id, amount, fin_fee_items(name)')
    .eq('academic_year', academicYear).eq('term_id', termId).eq('branch', branch).eq('grade', grade).eq('is_active', true);
  if (structError) throw structError;
  if (!structureRows || !structureRows.length) return 0;

  let created = 0;
  for (const row of structureRows) {
    const { error: insError } = await supabaseAdmin.from('fin_dues').insert({
      student_id: studentId, academic_year: academicYear, term_id: termId, branch, grade,
      fee_item_id: row.fee_item_id, fee_structure_id: row.id, description: row.fin_fee_items?.name || 'رسوم دراسية', amount: row.amount,
    });
    if (!insError) created++;
    else if (insError.code !== '23505') throw insError;
  }

  if (created > 0) {
    await supabaseAdmin.rpc('fin_recalc_student_clearance', { p_student_id: studentId, p_academic_year: academicYear, p_term_id: termId });
    if (user) {
      await supabaseAdmin.from('audit_log').insert({
        emp_id: user.id, emp_name: user.fullName, role: user.role, action: 'توليد استحقاقات مالية',
        details: { studentId, academicYear, termId, created }, branch, entity: 'fin_dues', entity_id: studentId, result: 'success',
      });
    }
  }
  return created;
}

/* -------------------- قائمة الطلاب مع حالة السداد -------------------- */
async function handleList(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin
    .from('students')
    .select('id, national_id, name_ar, branch, stage, grade, section')
    .is('deleted_at', null)
    .order('name_ar');
  query = applyBranchFilter(query, branches);
  if (body.grade) query = query.eq('grade', body.grade);
  if (body.section) query = query.eq('section', body.section);

  const search = (body.search || '').trim();
  if (search) {
    const term = `%${search}%`;
    query = query.or(`name_ar.ilike.${term},national_id.ilike.${term},id.ilike.${term}`);
  }

  const { data: students, error } = await query;
  if (error) throw error;
  let resultStudents = students || [];

  // 🆕 لو البحث بلا نتائج مباشرة، نجرِّب البحث باسم ولي الأمر (بند "قائمة الطلاب... ولي الأمر" بمواصفاتك)
  if (search) {
    const term = `%${search}%`;
    const { data: matchedParents } = await supabaseAdmin.from('parent_info').select('id').ilike('name_ar', term);
    if (matchedParents && matchedParents.length) {
      const { data: links } = await supabaseAdmin.from('parent_student_links').select('student_id').in('parent_id', matchedParents.map((p) => p.id));
      const existingIds = new Set(resultStudents.map((s) => s.id));
      const extraIds = [...new Set((links || []).map((l) => l.student_id))].filter((id) => !existingIds.has(id));
      if (extraIds.length) {
        let extraQuery = supabaseAdmin.from('students').select('id, national_id, name_ar, branch, stage, grade, section').is('deleted_at', null).in('id', extraIds);
        extraQuery = applyBranchFilter(extraQuery, branches);
        if (body.grade) extraQuery = extraQuery.eq('grade', body.grade);
        if (body.section) extraQuery = extraQuery.eq('section', body.section);
        const { data: extraStudents } = await extraQuery;
        resultStudents = [...resultStudents, ...(extraStudents || [])];
      }
    }
  }

  const ids = resultStudents.map((s) => s.id);
  const { data: clearanceRows } = ids.length
    ? await supabaseAdmin.from('fin_student_clearance').select('student_id, status, academic_year, term_id, updated_at').in('student_id', ids).order('updated_at', { ascending: false })
    : { data: [] };

  const clearanceMap = {};
  (clearanceRows || []).forEach((c) => { if (!clearanceMap[c.student_id]) clearanceMap[c.student_id] = c; }); // أول ظهور = الأحدث (بسبب الترتيب)

  const enriched = resultStudents.map((s) => ({
    id: s.id, nationalId: s.national_id, nameAr: s.name_ar,
    branch: s.branch, stage: s.stage, grade: s.grade, section: s.section,
    financialStatus: clearanceMap[s.id]?.status || 'NO_INVOICES',
  }));

  return res.status(200).json({ success: true, data: enriched });
}

/* -------------------- البطاقة المالية لطالب واحد -------------------- */
async function handleGetCard(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const { studentId } = validateBody(z.object({ studentId: z.string().min(1, 'رقم الطالب مطلوب') }), req.body);

  const { data: student, error: stuError } = await supabaseAdmin
    .from('students').select('id, national_id, name_ar, branch, stage, grade, section').eq('id', studentId).is('deleted_at', null).maybeSingle();
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

  // 🆕 ربط تلقائي بالإعدادات المالية — الفصل الحالي (is_visible=true)
  // يُولَّد له استحقاقات هذا الطالب فوراً من هيكل الرسوم المعتمد لفرعه
  // وصفّه، بلا أي زر أو خطوة يدوية. فشل هذا مثلاً لعدم وجود فصل محدَّد
  // كـ"حالي" بعد، أو عدم وجود هيكل رسوم لهذا الفرع/الصف بعد لا يكسر عرض
  // البطاقة إطلاقاً — فقط تظهر قائمة استحقاقات فارغة.
  try {
    const { data: currentTerm } = await supabaseAdmin.from('academic_terms').select('id, academic_year').eq('is_visible', true).maybeSingle();
    if (currentTerm) {
      await generateDuesForStudent(student.id, student.branch, student.grade, currentTerm.academic_year, currentTerm.id, user);
    }
  } catch (e) {
    console.error('[تحذير: تعذّر التوليد التلقائي للاستحقاقات]', e);
  }

  const { data: dues, error: duesError } = await supabaseAdmin
    .from('fin_dues').select('*').eq('student_id', studentId).neq('status', 'cancelled').order('created_at', { ascending: false });
  if (duesError) throw duesError;

  const { data: invoices, error: invError } = await supabaseAdmin
    .from('fin_invoices').select('*').eq('student_id', studentId).neq('status', 'void').order('issue_date', { ascending: false });
  if (invError) throw invError;

  const { data: clearance, error: clearError } = await supabaseAdmin
    .from('fin_student_clearance').select('*').eq('student_id', studentId).order('updated_at', { ascending: false });
  if (clearError) throw clearError;

  const totalOutstanding = (dues || []).reduce((s, d) => s + (Number(d.amount) - Number(d.discount_amount) - Number(d.paid_amount)), 0);

  return res.status(200).json({
    success: true,
    data: { student, dues: dues || [], invoices: invoices || [], clearance: clearance || [], totalOutstanding },
  });
}

/* -------------------- توليد استحقاقات صريح (فصل آخر/تحضير مبكر) -------------------- */
async function handleGenerateDues(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const d = validateBody(generateDuesSchema, req.body);

  const { data: student, error: stuError } = await supabaseAdmin
    .from('students').select('id, branch, grade').eq('id', d.studentId).is('deleted_at', null).maybeSingle();
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

  const created = await generateDuesForStudent(student.id, student.branch, student.grade, d.academicYear, d.termId, user);
  return res.status(200).json({
    success: true,
    data: {
      created,
      message: created ? `تم توليد ${created} استحقاق جديد` : 'لا توجد رسوم معدَّة لهذا الفرع والصف بهذا العام والفصل، أو أن الاستحقاقات موجودة مسبقاً',
    },
  });
}

/* -------------------- قائمة استحقاقات طالب -------------------- */
async function handleListDues(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const d = validateBody(listDuesSchema, req.body);

  const { data, error } = await supabaseAdmin
    .from('fin_dues').select('*').eq('student_id', d.studentId).neq('status', 'cancelled').order('created_at', { ascending: false });
  if (error) throw error;
  return res.status(200).json({ success: true, data });
}

/* -------------------- كشف حساب الطالب (فواتير + دفعات + رصيد متراكم) -------------------- */
async function handleGetStatement(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const d = validateBody(z.object({
    studentId: z.string().min(1),
    academicYear: z.string().optional(),
    termId: z.union([z.string(), z.number()]).optional(),
  }), req.body);

  let query = supabaseAdmin.from('fin_student_ledger_view').select('*').eq('student_id', d.studentId).order('entry_date', { ascending: true });
  if (d.academicYear) query = query.eq('academic_year', d.academicYear);
  if (d.termId) query = query.eq('term_id', d.termId);

  const { data, error } = await query;
  if (error) throw error;

  let runningBalance = 0;
  const ledger = (data || []).map((row) => {
    runningBalance += Number(row.debit) - Number(row.credit);
    return { ...row, runningBalance };
  });

  return res.status(200).json({ success: true, data: { ledger, currentBalance: runningBalance } });
}

/* -------------------- تعيين حالة مالية يدوية (إعفاء / إيقاف مالي) -------------------- */
async function handleSetManualStatus(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_STATUS_ROLES_);
  const d = validateBody(z.object({
    studentId: z.string().min(1),
    academicYear: z.string().min(1),
    termId: z.union([z.string(), z.number()]),
    status: z.enum(['EXEMPT', 'BLOCKED'], { errorMap: () => ({ message: 'الحالة اليدوية يجب أن تكون إعفاء أو إيقاف مالي فقط' }) }),
    reason: z.string().min(1, 'سبب الحالة اليدوية مطلوب').max(500),
  }), req.body);

  const allowResultRelease = d.status === 'EXEMPT';

  const { error } = await supabaseAdmin.from('fin_student_clearance').upsert({
    student_id: d.studentId, academic_year: d.academicYear, term_id: d.termId,
    status: d.status, allow_result_release: allowResultRelease,
    is_manual_override: true, override_reason: d.reason, overridden_by: user.id, overridden_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'student_id,academic_year,term_id' });
  if (error) throw error;

  await writeAudit(user, `تعيين حالة مالية يدوية: ${d.status}`, { studentId: d.studentId, academicYear: d.academicYear, termId: d.termId, reason: d.reason }, d.studentId);

  return res.status(200).json({ success: true, data: true });
}

/* -------------------- إلغاء الحالة اليدوية والرجوع للحساب التلقائي -------------------- */
async function handleRevertToAutomatic(req, res) {
  const user = requireAuth(req);
  requireRole(user, MANAGE_STATUS_ROLES_);
  const d = validateBody(z.object({
    studentId: z.string().min(1),
    academicYear: z.string().min(1),
    termId: z.union([z.string(), z.number()]),
  }), req.body);

  const { error: clearError } = await supabaseAdmin.from('fin_student_clearance').update({
    is_manual_override: false, override_reason: null, overridden_by: null, overridden_at: null,
  }).eq('student_id', d.studentId).eq('academic_year', d.academicYear).eq('term_id', d.termId);
  if (clearError) throw clearError;

  // إعادة الحساب التلقائي فوراً بنفس دالة قاعدة البيانات المستخدَمة بـTrigger الدفعات
  const { error: rpcError } = await supabaseAdmin.rpc('fin_recalc_student_clearance', {
    p_student_id: d.studentId, p_academic_year: d.academicYear, p_term_id: d.termId,
  });
  if (rpcError) throw rpcError;

  await writeAudit(user, 'إلغاء الحالة المالية اليدوية (رجوع تلقائي)', { studentId: d.studentId, academicYear: d.academicYear, termId: d.termId }, d.studentId);

  return res.status(200).json({ success: true, data: true });
}

/** مساعد مشترك لتقارير الحالة (متأخرون/غير مسددين/إعفاءات) */
async function reportByStatus(req, res, status) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const body = req.body || {};
  const branches = resolveBranchScope(user, body.branch);

  let query = supabaseAdmin.from('fin_student_clearance').select('student_id, academic_year, term_id, status, updated_at').eq('status', status);
  if (body.academicYear) query = query.eq('academic_year', body.academicYear);
  if (body.termId) query = query.eq('term_id', body.termId);
  const { data: clearanceRows, error } = await query;
  if (error) throw error;

  if (!clearanceRows || !clearanceRows.length) return res.status(200).json({ success: true, data: [] });

  let studentsQuery = supabaseAdmin.from('students').select('id, national_id, name_ar, branch, grade, section').in('id', clearanceRows.map((c) => c.student_id));
  studentsQuery = applyBranchFilter(studentsQuery, branches);
  const { data: students, error: stuError } = await studentsQuery;
  if (stuError) throw stuError;

  const studentMap = {};
  (students || []).forEach((s) => { studentMap[s.id] = s; });

  const result = clearanceRows
    .filter((c) => studentMap[c.student_id])
    .map((c) => ({ ...studentMap[c.student_id], academicYear: c.academic_year, termId: c.term_id, statusUpdatedAt: c.updated_at }));

  return res.status(200).json({ success: true, data: result });
}

async function handleReportOverdue(req, res) { return reportByStatus(req, res, 'OVERDUE'); }
async function handleReportUnpaid(req, res) { return reportByStatus(req, res, 'UNPAID'); }
async function handleReportExemptions(req, res) { return reportByStatus(req, res, 'EXEMPT'); }

/* -------------------- تقرير الرسوم حسب الصف والفرع -------------------- */
async function handleReportFeesByGradeBranch(req, res) {
  const user = requireAuth(req);
  requireRole(user, VIEW_ROLES_);
  const d = validateBody(z.object({
    academicYear: z.string().min(1),
    termId: z.union([z.string(), z.number()]),
  }), req.body);

  const { data, error } = await supabaseAdmin
    .from('fin_fee_structure')
    .select('branch, grade, amount, fin_fee_items(name)')
    .eq('academic_year', d.academicYear)
    .eq('term_id', d.termId)
    .eq('is_active', true)
    .order('branch').order('grade');
  if (error) throw error;

  const result = (data || []).map((r) => ({ branch: r.branch, grade: r.grade, feeItem: r.fin_fee_items?.name || null, amount: Number(r.amount) }));
  return res.status(200).json({ success: true, data: result });
}

export default createRouter({
  list: handleList,
  getCard: handleGetCard,
  generateDues: handleGenerateDues,
  listDues: handleListDues,
  getStatement: handleGetStatement,
  setManualStatus: handleSetManualStatus,
  revertToAutomatic: handleRevertToAutomatic,
  reportOverdue: handleReportOverdue,
  reportUnpaid: handleReportUnpaid,
  reportExemptions: handleReportExemptions,
  reportFeesByGradeBranch: handleReportFeesByGradeBranch,
});
