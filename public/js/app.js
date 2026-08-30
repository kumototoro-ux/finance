// public/js/app.js  —  موقع الإدارة المالية (finance)
// =====================================================================
// الملف المحوري لواجهة موقع الإدارة المالية — نفس فلسفة app.js بموقع
// الموظفين (تسجيل الدخول + شل + قائمة جانبية + توجيه بين الصفحات عبر
// PAGE_REGISTRY)، لكن بمحتوى مالي بالكامل.
//
// كل صفحة مالية (لوحة التحكم، الطلاب، الفواتير...) تُضاف لاحقاً كدالة
// renderXxxView() + سجل بـPAGE_REGISTRY — نفس نمط توسعة الموقع الأصلي
// بالضبط، حتى يبقى هذا الملف قابلاً للنمو بأمان مع كل صفحة جديدة.
// =====================================================================

const APP = { token: null, user: null };

/* ===================== خارطة الصفحات (تُستكمل مع كل صفحة قادمة) ===================== */
// كل مفتاح هنا = دالة renderXxxView مطابقة، وأيقونة، وتسمية عربية.
// أدوار الوصول مطابقة لأدوار كل ملف API الخاص بالصفحة (راجع الباك إند).
const PAGE_REGISTRY = {
  home: { label: 'الرئيسية', icon: 'home', roles: ['role_admin', 'role_finance_admin', 'role_accountant', 'role_collection_monitor'] },
  // 🆕 الصفحات القادمة تُضاف هنا صفحة بصفحة:
  // students: { label: 'الطلاب', icon: 'students', roles: [...] },
  // invoices: { label: 'الفواتير', icon: 'invoice', roles: [...] },
  // payments: { label: 'الدفعات', icon: 'payment', roles: [...] },
  // collection: { label: 'التحصيل والرقابة', icon: 'branches', roles: [...] },
  // reconciliation: { label: 'المطابقة', icon: 'reconciliation', roles: [...] },
  // financialPeriods: { label: 'الفترات المالية', icon: 'period', roles: [...] },
  // revenuesExpenses: { label: 'المالية', icon: 'revenue', roles: [...] },
  // payroll: { label: 'الرواتب', icon: 'payroll', roles: [...] },
  // financeStaff: { label: 'موظفو المالية', icon: 'staff', roles: ['role_admin', 'role_finance_admin'] },
  // feeSettings: { label: 'الإعدادات', icon: 'settings', roles: ['role_admin', 'role_finance_admin'] },
  // auditLog: { label: 'سجل التدقيق', icon: 'audit', roles: ['role_admin', 'role_finance_admin'] },
};

const SIDEBAR_SECTIONS = [
  { label: null, keys: ['home'] },
  // 🆕 تُقسَّم بقية الصفحات لأقسام (الطلاب/الفواتير، التحصيل والرقابة، الإدارة) مع كل صفحة قادمة
];

/* ===================== نقطة الانطلاق ===================== */
document.addEventListener('DOMContentLoaded', () => {
  const savedToken = localStorage.getItem('finance_token');
  const savedUser = localStorage.getItem('finance_user');
  if (savedToken && savedUser) {
    APP.token = savedToken;
    APP.user = JSON.parse(savedUser);
    bootDashboard();
  } else {
    renderLogin();
  }
});

/* ===================== تسجيل الدخول ===================== */
function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">${ICONS.logo()}</div>
        <div class="login-platform-name">منصة مِرقاة التعليمية</div>
        <h2>الإدارة المالية</h2>
        <div class="field"><label>اسم المستخدم</label><input id="loginUsername" type="text" autocomplete="username"></div>
        <div class="field"><label>كلمة المرور</label><input id="loginPassword" type="password" autocomplete="current-password"></div>
        <button id="loginBtn">دخول</button>
      </div>
    </div>`;

  const submit = () => doLogin();
  document.getElementById('loginBtn').addEventListener('click', submit);
  document.getElementById('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function doLogin() {
  const btn = document.getElementById('loginBtn');
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) { showToast('أدخل اسم المستخدم وكلمة المرور', 'error'); return; }

  btn.disabled = true; btn.textContent = 'جارِ الدخول...';
  try {
    const data = await apiCall('auth', { method: 'POST', body: { action: 'login', username, password }, requiresAuth: false });
    APP.token = data.token;
    APP.user = data.user;
    localStorage.setItem('finance_token', APP.token);
    localStorage.setItem('finance_user', JSON.stringify(APP.user));

    if (data.firstLogin) {
      renderForceChangePassword();
    } else {
      showToast('مرحباً ' + APP.user.fullName, 'success');
      bootDashboard();
    }
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'دخول';
  }
}

function renderForceChangePassword() {
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h2>تعيين كلمة مرور جديدة</h2>
        <p class="login-sub">هذا أول دخول لك، يجب تعيين كلمة مرور جديدة قبل المتابعة</p>
        <div class="field"><label>كلمة المرور الجديدة</label><input id="newPassword" type="password"></div>
        <button id="setPasswordBtn">تعيين وحفظ</button>
      </div>
    </div>`;

  document.getElementById('setPasswordBtn').addEventListener('click', async () => {
    const btn = document.getElementById('setPasswordBtn');
    const newPassword = document.getElementById('newPassword').value;
    if (newPassword.length < 6) { showToast('كلمة المرور يجب ألا تقل عن 6 أحرف', 'error'); return; }

    btn.disabled = true; btn.textContent = 'جارِ الحفظ...';
    try {
      await apiCall('auth', { method: 'POST', body: { action: 'forceSetPassword', newPassword } });
      showToast('تم تعيين كلمة المرور بنجاح', 'success');
      bootDashboard();
    } catch (e) {
      showToast(e.message, 'error');
      btn.disabled = false; btn.textContent = 'تعيين وحفظ';
    }
  });
}

async function doLogout() {
  try { await apiCall('auth', { method: 'POST', body: { action: 'logout' } }); } catch (e) { /* لا يهم فشل الطلب */ }
  localStorage.removeItem('finance_token');
  localStorage.removeItem('finance_user');
  APP.token = null; APP.user = null;
  renderLogin();
}

/* ===================== هيكل لوحة التحكم ===================== */
function bootDashboard() {
  renderShell();
  navigate('home');
}

function renderShell() {
  const nameInitial = (APP.user.fullName || '?').trim().charAt(0);
  document.getElementById('app').innerHTML = `
    <div class="app-body">
      <div class="sidebar-overlay" id="sidebarOverlay"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          ${ICONS.logo()}<span>الإدارة المالية</span>
          <button type="button" class="sidebar-close-btn" id="sidebarCloseBtn">${ICONS.close()}</button>
        </div>
        <nav id="sidebarNav"></nav>
      </aside>
      <div class="app-main-col">
        <header class="app-header">
          <div class="header-start">
            <button class="menu-toggle-btn" id="menuToggleBtn">${ICONS.menu()}</button>
            <div class="header-brand-mobile">${ICONS.logo()}<span>الإدارة المالية</span></div>
            <div class="app-header-title" id="pageTitle">الرئيسية</div>
          </div>
          <div class="header-branch-label">${escapeHtml(APP.user.branch || '')}</div>
          <div class="header-user" id="headerUser">
            <div class="user-avatar">${escapeHtml(nameInitial)}</div>
            <div class="user-name">${escapeHtml(APP.user.fullName)}</div>
          </div>
        </header>
        <main class="main-content content-fade-in" id="mainContent"></main>
      </div>
    </div>`;

  renderSidebarNav();

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const openSidebar = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
  const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

  document.getElementById('menuToggleBtn').addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);
  document.getElementById('headerUser').addEventListener('click', () => {
    if (confirm('تسجيل الخروج؟')) doLogout();
  });
}

function renderSidebarNav() {
  const nav = document.getElementById('sidebarNav');
  const accessibleKeys = Object.keys(PAGE_REGISTRY).filter((key) => PAGE_REGISTRY[key].roles.includes(APP.user.role));

  nav.innerHTML = SIDEBAR_SECTIONS.map((section) => {
    const keys = section.keys.filter((k) => accessibleKeys.includes(k));
    if (!keys.length) return '';
    const sectionLabel = section.label ? `<div class="sidebar-section-label">${escapeHtml(section.label)}</div>` : '';
    const links = keys.map((key) => {
      const page = PAGE_REGISTRY[key];
      return `<a data-page="${key}">${ICONS[page.icon]()}<span>${escapeHtml(page.label)}</span></a>`;
    }).join('');
    return sectionLabel + links;
  }).join('');

  nav.querySelectorAll('[data-page]').forEach((link) => {
    link.addEventListener('click', () => navigate(link.getAttribute('data-page')));
  });
}

/* ===================== التوجيه بين الصفحات ===================== */
function navigate(pageKey) {
  const page = PAGE_REGISTRY[pageKey];
  if (!page || !page.roles.includes(APP.user.role)) {
    showToast('لا تملك صلاحية الوصول لهذه الصفحة', 'error');
    return;
  }

  document.getElementById('pageTitle').textContent = page.label;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
  document.querySelectorAll('#sidebarNav a').forEach((a) => a.classList.toggle('active', a.getAttribute('data-page') === pageKey));

  const renderFn = window[`render${pageKey.charAt(0).toUpperCase() + pageKey.slice(1)}View`];
  if (typeof renderFn === 'function') {
    renderFn();
  } else {
    document.getElementById('mainContent').innerHTML = `<div class="card"><p style="color:#888">هذه الصفحة قيد الإنشاء بعد</p></div>`;
  }
}

/* ===================== صفحة الرئيسية (لوحة الإدارة المالية) ===================== */
// 🆕 نسخة أولية بسيطة الآن — سنطوّرها بفلاتر الفترة/الفرع والرسوم
// البيانية عند استكمال بقية الصفحات (تحتاج فهم أنماط app.js الأصلي
// أكثر لبناء الفلاتر المتّسقة بصرياً).
async function renderHomeView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="card"><div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div><div class="skel-row"></div></div></div>`;

  try {
    const data = await apiCall('dashboard', { method: 'POST', body: { action: 'getMainDashboard' } });
    const k = data.kpis;

    main.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">إجمالي الإيرادات</div><div class="kpi-value">${formatMoney(k.totalRevenue)}</div></div>
        <div class="kpi-card"><div class="kpi-label">إجمالي المصروفات</div><div class="kpi-value">${formatMoney(k.totalExpenses)}</div></div>
        <div class="kpi-card"><div class="kpi-label">صافي الدخل</div><div class="kpi-value ${k.netIncome >= 0 ? 'positive' : 'negative'}">${formatMoney(k.netIncome)}</div></div>
        <div class="kpi-card"><div class="kpi-label">إجمالي التحصيل</div><div class="kpi-value">${formatMoney(k.totalCollection)}</div></div>
        <div class="kpi-card"><div class="kpi-label">تحصيل اليوم</div><div class="kpi-value">${formatMoney(k.todayCollection)}</div></div>
        <div class="kpi-card"><div class="kpi-label">المبالغ المستحقة</div><div class="kpi-value">${formatMoney(k.outstandingAmount)}</div></div>
        <div class="kpi-card"><div class="kpi-label">المتأخرات</div><div class="kpi-value negative">${formatMoney(k.overdueAmount)}</div></div>
      </div>
      <div class="card">
        <h3>آخر العمليات المالية</h3>
        ${data.recentTransactions.length ? data.recentTransactions.map((t) => `
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--surface);">
            <span>${escapeHtml(t.reference)} — ${escapeHtml(t.branch)}</span>
            <span style="font-weight:700">${formatMoney(t.amount)}</span>
          </div>`).join('') : '<p style="color:#888">لا توجد عمليات بعد</p>'}
      </div>`;
  } catch (e) {
    main.innerHTML = `<div class="card"><p style="color:#C4483A">${escapeHtml(e.message)}</p></div>`;
  }
}
