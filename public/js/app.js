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

const ROLE_LABELS_AR = {
  role_admin: 'الأدمن العام',
  role_finance_admin: 'أدمن الإدارة المالية',
  role_accountant: 'محاسب',
  role_collection_monitor: 'مراقب الفروع والتحصيل',
};

/* ===================== خارطة الصفحات ===================== */
// كل صفحة لسه ما بُنيت فعلياً تُشير مؤقّتاً لـcomingSoonRender() — تعرض
// "قيد الإنشاء" بدل كسر التنقّل. تُستبدَل بدالة renderXxxView حقيقية
// أول ما تُبنى الصفحة، بلا أي تعديل على بقية الملف.
function comingSoonRender(label) {
  return function () {
    document.getElementById('mainContent').innerHTML = `
      <div class="card">
        <h3>${escapeHtml(label)}</h3>
        <p style="color:#888">هذه الصفحة قيد الإنشاء بعد — قريباً</p>
      </div>`;
  };
}

const PAGE_REGISTRY = {
  home: { label: 'الرئيسية', icon: 'home', render: renderHomeView },
  students: { label: 'الطلاب', icon: 'students', render: comingSoonRender('الطلاب') },
  invoices: { label: 'الفواتير', icon: 'invoice', render: comingSoonRender('الفواتير') },
  payments: { label: 'الدفعات', icon: 'payment', render: comingSoonRender('الدفعات') },
  collection: { label: 'التحصيل والرقابة', icon: 'branches', render: comingSoonRender('التحصيل والرقابة') },
  reconciliation: { label: 'المطابقة المالية', icon: 'reconciliation', render: comingSoonRender('المطابقة المالية') },
  financialPeriods: { label: 'الفترات المالية', icon: 'period', render: comingSoonRender('الفترات المالية') },
  revenuesExpenses: { label: 'الإيرادات والمصروفات', icon: 'revenue', render: comingSoonRender('الإيرادات والمصروفات') },
  payroll: { label: 'الرواتب', icon: 'payroll', render: comingSoonRender('الرواتب') },
  financeStaff: { label: 'موظفو المالية', icon: 'staff', render: comingSoonRender('موظفو المالية') },
  feeSettings: { label: 'الإعدادات', icon: 'settings', render: comingSoonRender('الإعدادات') },
  auditLog: { label: 'سجل التدقيق', icon: 'audit', render: comingSoonRender('سجل التدقيق') },
};

/** أي دور غير مذكور هنا يحصل تلقائياً على "الرئيسية" فقط */
const ROLE_PAGES = {
  role_admin: ['home', 'students', 'invoices', 'payments', 'collection', 'reconciliation', 'financialPeriods', 'revenuesExpenses', 'payroll', 'financeStaff', 'feeSettings', 'auditLog'],
  role_finance_admin: ['home', 'students', 'invoices', 'payments', 'collection', 'reconciliation', 'financialPeriods', 'revenuesExpenses', 'payroll', 'financeStaff', 'feeSettings', 'auditLog'],
  role_accountant: ['home', 'students', 'invoices', 'payments', 'revenuesExpenses', 'payroll'],
  role_collection_monitor: ['home', 'collection', 'reconciliation'],
};

function pagesForCurrentUser() {
  return ROLE_PAGES[APP.user.role] || ['home'];
}

/** مجموعات الشريط الجانبي — عناوين مفردة بلا مجموعة، وقوائم قابلة للطيّ لكل فئة.
 * أي مجموعة تصبح فارغة لدور معيّن تختفي تلقائياً بلا أثر. */
const SIDEBAR_GROUPS = [
  { type: 'single', key: 'home' },
  { type: 'group', label: 'الطلاب والفواتير', icon: 'students', items: ['students', 'invoices', 'payments'] },
  { type: 'group', label: 'التحصيل والرقابة', icon: 'branches', items: ['collection', 'reconciliation'] },
  { type: 'group', label: 'المالية', icon: 'revenue', items: ['revenuesExpenses', 'payroll', 'financialPeriods'] },
  { type: 'group', label: 'الإدارة والإعدادات', icon: 'settings', items: ['financeStaff', 'feeSettings', 'auditLog'] },
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
            ${ICONS.chevronDown()}
            <div class="user-dropdown" id="userDropdown">
              <div class="user-dropdown-info">
                <div class="user-dropdown-name">${escapeHtml(APP.user.fullName)}</div>
                <div class="user-dropdown-role">${escapeHtml(ROLE_LABELS_AR[APP.user.role] || APP.user.role)}</div>
              </div>
              <button type="button" id="openProfileInfoBtn">${ICONS.users()} الملف الشخصي</button>
              <button type="button" id="dropdownLogoutBtn">${ICONS.logout()} تسجيل الخروج</button>
            </div>
          </div>
        </header>
        <main class="main-content content-fade-in" id="mainContent"></main>
        <nav class="bottom-nav" id="bottomNav"></nav>
      </div>
    </div>`;

  const pages = pagesForCurrentUser();
  const lastView = localStorage.getItem('finance_lastView');
  renderGroupedSidebarNav(pages, lastView && pages.includes(lastView) ? lastView : pages[0]);
  renderBottomNav();

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const openSidebar = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
  document.getElementById('menuToggleBtn').addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebarMobile() : openSidebar();
  });
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebarMobile);
  overlay.addEventListener('click', closeSidebarMobile);

  // قائمة حساب المستخدم المنسدلة
  document.getElementById('headerUser').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('userDropdown').classList.toggle('show');
  });
  document.addEventListener('click', () => document.getElementById('userDropdown')?.classList.remove('show'));
  document.getElementById('dropdownLogoutBtn').addEventListener('click', doLogout);
  document.getElementById('openProfileInfoBtn').addEventListener('click', openMyProfileModal);
}

function closeSidebarMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

function renderGroupedSidebarNav(pages, activeView) {
  const nav = document.getElementById('sidebarNav');
  const singleLinkHtml = (key) => `<a data-page="${key}" title="${escapeHtml(PAGE_REGISTRY[key].label)}">${ICONS[PAGE_REGISTRY[key].icon]()}<span>${escapeHtml(PAGE_REGISTRY[key].label)}</span></a>`;

  nav.innerHTML = SIDEBAR_GROUPS.map((g) => {
    if (g.type === 'single') {
      return pages.includes(g.key) ? singleLinkHtml(g.key) : '';
    }
    const visibleItems = g.items.filter((k) => pages.includes(k));
    if (!visibleItems.length) return '';
    const isActiveGroup = visibleItems.includes(activeView);
    return `
      <div class="sidebar-group">
        <button type="button" class="sidebar-group-header ${isActiveGroup ? 'expanded' : ''}" data-group-toggle>
          ${ICONS[g.icon]()}<span>${escapeHtml(g.label)}</span>${ICONS.chevronDown()}
        </button>
        <div class="sidebar-group-items" style="display:${isActiveGroup ? 'block' : 'none'}">
          ${visibleItems.map(singleLinkHtml).join('')}
        </div>
      </div>`;
  }).join('');

  nav.querySelectorAll('[data-group-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const itemsBox = btn.nextElementSibling;
      const willOpen = itemsBox.style.display !== 'block';
      itemsBox.style.display = willOpen ? 'block' : 'none';
      btn.classList.toggle('expanded', willOpen);
    });
  });
  nav.querySelectorAll('[data-page]').forEach((link) => {
    link.addEventListener('click', () => navigate(link.getAttribute('data-page')));
  });
}

/** الشريط السفلي بالجوال — 4 اختصارات ثابتة، منفصلة تماماً عن القائمة
 * الجانبية الكاملة (تُفتَح بزر ☰ أو زر "المزيد"). */
function renderBottomNav() {
  const pages = pagesForCurrentUser();
  const BOTTOM_NAV_ITEMS = [
    { key: 'home', label: 'الرئيسية', icon: 'home', ready: true },
    { key: 'students', label: 'الطلاب', icon: 'students', ready: false },
    { key: 'payments', label: 'الدفعات', icon: 'payment', ready: false },
    { key: 'more', label: 'المزيد', icon: 'menu', ready: true },
  ].filter((item) => item.key === 'more' || pages.includes(item.key));

  document.getElementById('bottomNav').innerHTML = BOTTOM_NAV_ITEMS
    .map((item) => `<a data-bottom-key="${item.key}" data-ready="${item.ready}">${ICONS[item.icon]()}<span>${escapeHtml(item.label)}</span></a>`)
    .join('');

  document.querySelectorAll('#bottomNav a').forEach((a) => {
    a.addEventListener('click', () => {
      const key = a.getAttribute('data-bottom-key');
      if (key === 'more') { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebarOverlay').classList.add('show'); return; }
      const isReady = a.getAttribute('data-ready') === 'true';
      if (!isReady) { showToast('قريباً — هذي الصفحة لم تُبنَ بعد', 'error'); return; }
      navigate(key);
    });
  });
}

/** نافذة تفاصيل عامة (Modal) — تُستخدَم للملف الشخصي، ولاحقاً لأي نموذج آخر */
function showDetailModal(title, subtitle, rows, footerHtml) {
  const existing = document.getElementById('detailModalOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'detailModalOverlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="modal-close-btn" id="modalCloseBtn">${ICONS.close()}</button>
      </div>
      <div class="modal-body" id="modalBodyContent">
        ${rows.map((r) => `
          <div class="modal-detail-row">
            <span class="modal-detail-label">${escapeHtml(r.label)}</span>
            <span class="modal-detail-value">${r.value ? escapeHtml(r.value) : '<span style="color:#bbb">—</span>'}</span>
          </div>`).join('')}
      </div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.getElementById('modalCloseBtn').addEventListener('click', close);
  return { overlay, close };
}

/** بطاقة الملف الشخصي — تفتح من القائمة المنسدلة بالشريط العلوي */
function openMyProfileModal() {
  const u = APP.user;
  const { overlay } = showDetailModal(u.fullName, ROLE_LABELS_AR[u.role] || u.role, [
    { label: 'اسم المستخدم', value: u.username },
    { label: 'الدور (الصلاحية)', value: ROLE_LABELS_AR[u.role] || u.role },
    { label: 'الفرع', value: u.branch },
  ], `
    <button type="button" id="openChangePasswordBtn" class="btn-outline-sm" style="width:100%;justify-content:center;margin-bottom:8px">${ICONS.key()} تغيير كلمة المرور</button>
    <button type="button" id="modalLogoutBtn" class="btn-danger-outline btn-outline-sm" style="width:100%;justify-content:center">${ICONS.logout()} تسجيل الخروج</button>
  `);

  document.getElementById('modalLogoutBtn').addEventListener('click', () => { overlay.remove(); doLogout(); });
  document.getElementById('openChangePasswordBtn').addEventListener('click', () => {
    const body = document.getElementById('modalBodyContent');
    body.innerHTML = `
      <div class="field"><label>كلمة المرور الجديدة</label><input type="password" id="myNewPassword" minlength="6"></div>
      <button type="button" id="saveNewPasswordBtn" style="width:100%">حفظ كلمة المرور الجديدة</button>`;
    document.getElementById('saveNewPasswordBtn').addEventListener('click', async () => {
      const newPassword = document.getElementById('myNewPassword').value;
      if (newPassword.length < 6) { showToast('كلمة المرور يجب ألا تقل عن 6 أحرف', 'error'); return; }
      try {
        await apiCall('auth', { method: 'POST', body: { action: 'forceSetPassword', newPassword } });
        showToast('تم تغيير كلمة المرور بنجاح', 'success');
        overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200);
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}

/* ===================== التوجيه بين الصفحات ===================== */
function navigate(pageKey) {
  const pages = pagesForCurrentUser();
  if (!PAGE_REGISTRY[pageKey] || !pages.includes(pageKey)) {
    pageKey = pages[0];
  }
  localStorage.setItem('finance_lastView', pageKey);

  const page = PAGE_REGISTRY[pageKey];
  document.getElementById('pageTitle').textContent = page.label;
  closeSidebarMobile();
  document.querySelectorAll('#sidebarNav a').forEach((a) => a.classList.toggle('active', a.getAttribute('data-page') === pageKey));
  document.querySelectorAll('#bottomNav a').forEach((a) => a.classList.toggle('active', a.getAttribute('data-bottom-key') === pageKey));

  // لو الصفحة النشطة داخل مجموعة قابلة للطيّ، افتحها تلقائياً حتى تظهر
  const activeLink = document.querySelector(`#sidebarNav a[data-page="${pageKey}"]`);
  const parentGroupItems = activeLink?.closest('.sidebar-group-items');
  if (parentGroupItems) {
    parentGroupItems.style.display = 'block';
    parentGroupItems.previousElementSibling?.classList.add('expanded');
  }

  page.render();

  const main = document.getElementById('mainContent');
  main.classList.remove('content-fade-in');
  void main.offsetWidth;
  main.classList.add('content-fade-in');
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
