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
