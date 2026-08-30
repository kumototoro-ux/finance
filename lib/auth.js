// lib/auth.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// نفس آلية JWT المعتمدة بموقع الموظفين بالضبط (Serverless بلا حالة،
// الرمز نفسه يحمل بيانات الجلسة موقَّعة رقمياً).
//
// ⚠️ قرار معماري مهم: نستخدم سرّاً منفصلاً تماماً (FINANCE_JWT_SECRET)
// عن سرّ موقع الموظفين (JWT_SECRET)، رغم مشاركة نفس قاعدة البيانات.
// السبب: الموقعان Vercel Project منفصلان بخادمين منفصلين — رمز جلسة
// صادر من موقع الموظفين لا يجب أن يُقبَل هنا بأي حال (والعكس)، حتى لو
// كان نفس الموظف يملك حساباً بالموقعين. هذا يعزل انتهاء الصلاحية/
// الإبطال بين الموقعين تماماً.
// =====================================================================

import jwt from 'jsonwebtoken';

const SESSION_DURATION = '6h';

export function issueSessionToken(userPayload) {
  return jwt.sign(userPayload, process.env.FINANCE_JWT_SECRET, { expiresIn: SESSION_DURATION });
}

/** أول سطر بأي دالة API قادمة تحتاج مصادقة */
export function requireAuth(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) throw new AuthError('الجلسة غير موجودة، الرجاء تسجيل الدخول');

  try {
    return jwt.verify(token, process.env.FINANCE_JWT_SECRET);
  } catch (e) {
    throw new AuthError('انتهت صلاحية الجلسة، الرجاء تسجيل الدخول من جديد');
  }
}

/** يرمي 403 لو الدور الحالي خارج القائمة المسموحة لهذا الإجراء */
export function requireRole(user, allowedRoles) {
  if (!allowedRoles.includes(user.role)) {
    const err = new Error('لا تملك صلاحية تنفيذ هذا الإجراء');
    err.statusCode = 403;
    throw err;
  }
}

/** 401 = مصادقة فعلية فقط (توكن غير موجود/منتهٍ) — نفس مبدأ موقع الموظفين */
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = 401;
  }
}
