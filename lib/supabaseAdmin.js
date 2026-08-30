// lib/supabaseAdmin.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// نفس قاعدة بيانات Supabase المركزية المستخدمة بموقع الموظفين بالضبط —
// اتصال واحد بصلاحيات كاملة (Service Role)، نتحقق من الصلاحيات يدوياً
// بكل دالة API (requireAuth/requireRole)، تماماً كما بالموقع الأصلي.
//
// ⚠️ متغيرات البيئة (SUPABASE_URL، SUPABASE_SERVICE_ROLE_KEY) يجب أن
// تكون بنفس قيم مشروع Supabase المستخدَم بموقع الموظفين بالضبط — قاعدة
// بيانات واحدة مشتركة بين الموقعين.
//
// ⚠️ لا تستخدم هذا المفتاح إطلاقاً بأي كود يعمل بالمتصفح (Frontend).
// =====================================================================

import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);
