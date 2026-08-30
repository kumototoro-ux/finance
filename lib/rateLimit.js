// lib/rateLimit.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// حماية من هجمات القوة الغاشمة على تسجيل الدخول — Upstash Redis.
// ⚠️ بادئة المفاتيح "ratelimit:finance:login" مختلفة عمداً عن بادئة
// موقع الموظفين ("ratelimit:login") — حتى لو استُخدمت نفس قاعدة Redis
// لكلا الموقعين، لا يحدث أي تداخل أو حظر متبادل خاطئ بينهما.
// =====================================================================

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const loginRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '60 s'),
  prefix: 'ratelimit:finance:login',
});

/** يرمي خطأ 429 لو تجاوز عدد المحاولات المسموح بها */
export async function checkLoginRateLimit(identifier) {
  const { success, remaining } = await loginRateLimiter.limit(identifier);
  if (!success) {
    const err = new Error('محاولات كثيرة جداً، حاول مرة أخرى بعد دقيقة');
    err.statusCode = 429;
    throw err;
  }
  return remaining;
}
