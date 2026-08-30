// public/js/api.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// نفس منطق api.js بموقع الموظفين بالضبط — نقطة اتصال مركزية واحدة.
// ⚠️ مفاتيح localStorage مختلفة تماماً عن موقع الموظفين عمداً
// (finance_token/finance_user بدل mirqat_token/mirqat_user) — لو نفس
// المستخدم فتح الموقعين بنفس المتصفح، كل جلسة تبقى مستقلة تماماً بلا
// أي تداخل أو استبدال غير مقصود.
// =====================================================================

const API_BASE = window.location.origin + '/api';
let inFlightRequests = 0;

function toggleGlobalLoading(active) {
  inFlightRequests += active ? 1 : -1;
  if (inFlightRequests < 0) inFlightRequests = 0;
  const bar = document.getElementById('progress-bar');
  if (bar) bar.classList.toggle('active', inFlightRequests > 0);
}

/**
 * الدالة المركزية الوحيدة لأي اتصال بالخادم بكل موقع الإدارة المالية.
 * @param {string} endpoint - اسم الملف بمجلد api (بدون /api/ ولا .js), مثال: 'auth'
 * @param {object} options - { method, body, requiresAuth }
 */
async function apiCall(endpoint, options = {}) {
  const { method = 'GET', body = null, requiresAuth = true } = options;

  toggleGlobalLoading(true);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (requiresAuth) {
      const token = localStorage.getItem('finance_token');
      if (!token) {
        handleSessionExpired();
        throw new Error('الجلسة غير موجودة');
      }
      headers['Authorization'] = 'Bearer ' + token;
    }

    const res = await fetch(`${API_BASE}/${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const result = await res.json().catch(() => ({ success: false, message: 'استجابة غير صحيحة من الخادم' }));

    if ((res.status === 401 || res.status === 403) && requiresAuth) {
      handleSessionExpired();
    }

    if (!result.success) {
      throw new Error(result.message || 'حدث خطأ غير متوقع');
    }
    return result.data;
  } finally {
    toggleGlobalLoading(false);
  }
}

function handleSessionExpired() {
  localStorage.removeItem('finance_token');
  localStorage.removeItem('finance_user');
  if (window.location.pathname !== '/') {
    window.location.href = '/';
  } else if (window.renderLogin) {
    window.renderLogin();
    showToast('انتهت جلستك، الرجاء تسجيل الدخول من جديد', 'error');
  }
}

/** نظام إشعارات موحَّد (Toast) — نفس النمط المعتمد بموقع الموظفين بالضبط */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** تنسيق مبلغ مالي بفاصلة آلاف + ريال — يُستخدَم بكل صفحة تقريباً */
function formatMoney(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
}
