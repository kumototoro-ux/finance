// lib/validation.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// كل مدخلات أي دالة API تمر عبر مخطط Zod هنا أولاً. هذا الملف يكبر مع
// كل ميزة مالية قادمة (فواتير، دفعات، مصروفات...) — بنفس مبدأ موقع
// الموظفين بالضبط.
// =====================================================================

import { z } from 'zod';

/* -------------------- المصادقة -------------------- */
export const loginSchema = z.object({
  username: z.string().trim().min(1, 'اسم المستخدم مطلوب').max(100),
  password: z.string().min(1, 'كلمة المرور مطلوبة').max(200),
});

export const forceSetNewPasswordSchema = z.object({
  newPassword: z.string().min(6, 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف').max(200),
});

/* -------------------- موظفو المالية (محاسبو الفروع) -------------------- */
// ⚠️ الأدوار هنا مقصورة على أدوار مالية فقط — لا يمكن لهذه الشاشة إنشاء
// موظف بدور "role_admin" (الأدمن العام يُنشَأ يدوياً مرة واحدة فقط)
export const addFinanceStaffSchema = z.object({
  nameAr: z.string().trim().min(2, 'الاسم بالعربي قصير جداً').max(100),
  nameEn: z.string().trim().max(100).optional().or(z.literal('')),
  nationalId: z.string().trim().regex(/^[A-Za-z0-9]{4,20}$/, 'رقم الهوية يجب أن يكون أحرفاً و/أو أرقاماً (4-20 خانة)'),
  role: z.enum(['role_finance_admin', 'role_accountant', 'role_collection_monitor'], {
    errorMap: () => ({ message: 'يجب اختيار دور مالي صحيح' }),
  }),
  branches: z.array(z.string().min(1)).min(1, 'يجب اختيار فرع واحد على الأقل'),
  gender: z.string().optional().or(z.literal('')),
});

export const updateFinanceStaffSchema = addFinanceStaffSchema.omit({ nationalId: true });

export const toggleFinanceStaffStatusSchema = z.object({
  id: z.string().min(1),
  newStatus: z.enum(['active', 'inactive'], { errorMap: () => ({ message: 'قيمة حالة غير صحيحة' }) }),
});

export const resetFinanceStaffPasswordSchema = z.object({
  id: z.string().min(1),
});

/* -------------------- إعدادات المالية (قوائم مرجعية + رسوم + حسابات) -------------------- */
// مخطط عام لأي قائمة مرجعية بسيطة (بند رسوم / تصنيف مصروف / طريقة دفع) — كلها بنفس الشكل: name فقط
export const addLookupNameSchema = z.object({
  name: z.string().trim().min(1, 'الاسم مطلوب').max(150),
});

export const toggleLookupActiveSchema = z.object({
  id: z.union([z.string(), z.number()]),
  isActive: z.boolean(),
});

export const setFeeStructureSchema = z.object({
  academicYear: z.string().min(1, 'العام الدراسي مطلوب'),
  termId: z.union([z.string(), z.number()]),
  branch: z.string().min(1, 'الفرع مطلوب'),
  grade: z.string().min(1, 'الصف مطلوب'),
  feeItemId: z.union([z.string(), z.number()]),
  amount: z.number().min(0, 'المبلغ يجب أن يكون صفراً أو أكبر'),
});

export const addAccountSchema = z.object({
  name: z.string().trim().min(1, 'اسم الحساب مطلوب').max(150),
  accountType: z.enum(['bank', 'cash', 'other'], { errorMap: () => ({ message: 'نوع حساب غير صحيح' }) }),
  branch: z.string().trim().optional().or(z.literal('')),
  accountNumber: z.string().trim().optional().or(z.literal('')),
});

export const updateAccountSchema = addAccountSchema.extend({
  id: z.union([z.string(), z.number()]),
});

/* -------------------- الفواتير -------------------- */
export const invoiceItemInputSchema = z.object({
  feeItemId: z.union([z.string(), z.number()]).optional(),
  description: z.string().min(1, 'وصف البند مطلوب').max(200),
  amount: z.number().min(0, 'المبلغ يجب أن يكون صفراً أو أكبر'),
  discountAmount: z.number().min(0).default(0),
});

export const issueInvoiceSchema = z.object({
  studentId: z.string().min(1, 'رقم الطالب مطلوب'),
  academicYear: z.string().min(1, 'العام الدراسي مطلوب'),
  termId: z.union([z.string(), z.number()]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة تاريخ الاستحقاق غير صحيحة').optional(),
  taxAmount: z.number().min(0).default(0),
  extraDiscountAmount: z.number().min(0).default(0),
  notes: z.string().max(500).optional().or(z.literal('')),
  useFeeStructure: z.boolean().default(true),
  items: z.array(invoiceItemInputSchema).optional(),
}).refine((d) => d.useFeeStructure || (d.items && d.items.length > 0), {
  message: 'يجب إدخال بند واحد على الأقل عند عدم استخدام هيكل الرسوم المعتمد',
  path: ['items'],
});

export const voidInvoiceSchema = z.object({
  invoiceId: z.union([z.string(), z.number()]),
  reason: z.string().min(1, 'سبب الإلغاء مطلوب').max(500),
});

/* -------------------- الدفعات -------------------- */
export const attachmentSchema = z.object({
  url: z.string().url('رابط المرفق غير صحيح'),
  name: z.string().max(150).optional().or(z.literal('')),
});

export const recordPaymentSchema = z.object({
  invoiceId: z.union([z.string(), z.number()]),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  paymentMethodId: z.union([z.string(), z.number()]),
  accountId: z.union([z.string(), z.number()]).optional(),
  referenceNumber: z.string().max(150).optional().or(z.literal('')),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة').optional(),
  attachments: z.array(attachmentSchema).optional(),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export const voidPaymentSchema = z.object({
  paymentId: z.union([z.string(), z.number()]),
  reason: z.string().min(1, 'سبب الإلغاء مطلوب').max(500),
});

/* -------------------- المطابقة المالية والفروقات -------------------- */
export const generateReconciliationSchema = z.object({
  periodId: z.union([z.string(), z.number()]),
});

export const reconciliationIdSchema = z.object({
  reconciliationId: z.union([z.string(), z.number()]),
});

export const submitReconciliationReasonSchema = z.object({
  reconciliationId: z.union([z.string(), z.number()]),
  reasonCategory: z.enum(
    ['advance_payment_next_term', 'prior_invoice_payment', 'recording_error', 'other_revenue', 'adjustment', 'other'],
    { errorMap: () => ({ message: 'يجب اختيار سبب صحيح من القائمة' }) }
  ),
  notes: z.string().min(1, 'تفاصيل السبب مطلوبة').max(1000),
  attachmentUrl: z.string().url('رابط المرفق غير صحيح').optional().or(z.literal('')),
});

/* -------------------- الفترات المالية -------------------- */
export const createPeriodSchema = z.object({
  name: z.string().trim().min(1, 'اسم الفترة مطلوب').max(150),
  branch: z.string().trim().optional().or(z.literal('')), // فارغ = تشمل كل الفروع
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة تاريخ البداية غير صحيحة'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة تاريخ النهاية غير صحيحة'),
});

export const periodIdSchema = z.object({
  periodId: z.union([z.string(), z.number()]),
});

export const reopenPeriodSchema = z.object({
  periodId: z.union([z.string(), z.number()]),
  reason: z.string().min(1, 'سبب إعادة الفتح مطلوب').max(500),
});

/* -------------------- الإيرادات الأخرى -------------------- */
export const addRevenueSchema = z.object({
  branch: z.string().min(1, 'الفرع مطلوب'),
  accountId: z.union([z.string(), z.number()]).optional(),
  category: z.string().trim().min(1, 'تصنيف الإيراد مطلوب').max(150),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  revenueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة').optional(),
  academicYear: z.string().optional().or(z.literal('')),
  termId: z.union([z.string(), z.number()]).optional(),
  description: z.string().max(500).optional().or(z.literal('')),
});

export const voidRevenueSchema = z.object({
  revenueId: z.union([z.string(), z.number()]),
  reason: z.string().min(1, 'سبب الإلغاء مطلوب').max(500),
});

/* -------------------- المصروفات -------------------- */
export const addExpenseSchema = z.object({
  expenseCategoryId: z.union([z.string(), z.number()]),
  branch: z.string().min(1, 'الفرع مطلوب'),
  accountId: z.union([z.string(), z.number()]).optional(),
  beneficiary: z.string().max(200).optional().or(z.literal('')),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة').optional(),
  description: z.string().max(500).optional().or(z.literal('')),
  attachments: z.array(attachmentSchema).optional(),
});

export const expenseIdSchema = z.object({
  expenseId: z.union([z.string(), z.number()]),
});

export const rejectExpenseSchema = z.object({
  expenseId: z.union([z.string(), z.number()]),
  reason: z.string().min(1, 'سبب الرفض مطلوب').max(500),
});

export const voidExpenseSchema = z.object({
  expenseId: z.union([z.string(), z.number()]),
  reason: z.string().min(1, 'سبب الإلغاء مطلوب').max(500),
});

// 🆕 كل مخطط قادم لميزة مالية جديدة (رسوم، فواتير، دفعات، مصروفات...)
// يُضاف هنا — نقطة مرجعية واحدة لكل قواعد التحقق بموقع الإدارة المالية.

/** يفحص body الطلب بمخطط معيّن، يرمي خطأ واضح موحَّد لو فشل الفحص */
export function validateBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const firstError = result.error.errors[0];
    const err = new Error(firstError.message);
    err.statusCode = 400;
    throw err;
  }
  return result.data;
}
