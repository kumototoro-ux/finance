// lib/router.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// مساعد توجيه بسيط — يقرأ "action" من الطلب ويستدعي الدالة المناسبة.
// نفس فكرة موقع الموظفين بالضبط: نجمع عدة إجراءات بملف واحد لتفادي حد
// الـ12 دالة بخطة Vercel المجانية، مع بقاء كل إجراء بدالة منفصلة واضحة.
//
// الاستخدام بأي ملف مُجمَّع:
//   export default createRouter({
//     list: handleList,
//     add: handleAdd,
//   });
// =====================================================================

import { apiHandler } from './apiHandler.js';

export function createRouter(actions) {
  return apiHandler(async (req, res) => {
    const action = (req.body && req.body.action) || req.query.action || 'default';
    const handler = actions[action];

    if (!handler) {
      const err = new Error(`إجراء غير معروف: ${action}`);
      err.statusCode = 400;
      throw err;
    }

    return handler(req, res);
  });
}
