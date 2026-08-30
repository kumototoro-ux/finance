// lib/apiHandler.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// غلاف واحد لكل دوال API — يوحّد: تنسيق الأخطاء، رموز الحالة، السجلّ
// بالخادم، وضمان أن أي خطأ غير متوقّع لا يُسرّب تفاصيل حساسة (خصوصاً
// حسّاس هنا لأن الملف يتعامل مع بيانات مالية).
//
// الاستخدام بأي دالة API قادمة:
//   export default apiHandler(async (req, res) => { ... منطقك هنا ... });
// =====================================================================

export function apiHandler(fn) {
  return async function (req, res) {
    try {
      await fn(req, res);
    } catch (e) {
      const statusCode = e.statusCode || 500;
      console.error(`[Finance API Error] ${req.url}:`, e);

      const safeMessage = statusCode === 500
        ? 'حدث خطأ غير متوقع بالخادم، حاول لاحقاً'
        : e.message;

      return res.status(statusCode).json({ success: false, message: safeMessage });
    }
  };
}
