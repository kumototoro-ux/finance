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
  financeStaff: { label: 'موظفو المالية', icon: 'staff', render: renderFinanceStaffView },
  users: { label: 'المستخدمون', icon: 'users', render: renderUsersView },
  feeSettings: { label: 'الإعدادات', icon: 'settings', render: comingSoonRender('الإعدادات') },
  auditLog: { label: 'سجل التدقيق', icon: 'audit', render: comingSoonRender('سجل التدقيق') },
};

/** أي دور غير مذكور هنا يحصل تلقائياً على "الرئيسية" فقط */
const ROLE_PAGES = {
  role_admin: ['home', 'students', 'invoices', 'payments', 'collection', 'reconciliation', 'financialPeriods', 'revenuesExpenses', 'payroll', 'financeStaff', 'users', 'feeSettings', 'auditLog'],
  role_finance_admin: ['home', 'students', 'invoices', 'payments', 'collection', 'reconciliation', 'financialPeriods', 'revenuesExpenses', 'payroll', 'financeStaff', 'users', 'feeSettings', 'auditLog'],
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
  { type: 'group', label: 'الإدارة والإعدادات', icon: 'settings', items: ['financeStaff', 'users', 'feeSettings', 'auditLog'] },
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

function computeBranchLabel(user) {
  const isFullAccess = user.role === 'role_admin' || user.role === 'role_finance_admin';
  if (isFullAccess) return 'كل الفروع';
  const branches = (user.allBranches && user.allBranches.length) ? user.allBranches : [user.branch];
  return branches.length > 1 ? `${branches.length} فروع` : (branches[0] || '');
}

function renderShell() {
  const nameInitial = (APP.user.fullName || '?').trim().charAt(0);
  document.getElementById('app').innerHTML = `
    <div class="app-body">
      <div class="sidebar-overlay" id="sidebarOverlay"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          ${ICONS.logo()}<span class="brand-text">الإدارة المالية</span>
          <button type="button" class="sidebar-collapse-btn" id="sidebarCollapseBtn" title="طي القائمة">${ICONS.chevronDown()}</button>
          <button type="button" class="sidebar-close-btn" id="sidebarCloseBtn" title="إغلاق القائمة">${ICONS.close()}</button>
        </div>
        <nav id="sidebarNav"></nav>
      </aside>
      <div class="app-main-col">
        <header class="app-header">
          <div class="header-start">
            <button class="menu-toggle-btn" id="menuToggleBtn">${ICONS.menu()}</button>
            <div class="app-header-title" id="pageTitle">الرئيسية</div>
          </div>
          <div class="header-school-brand" id="headerSchoolBrand">
            <div class="header-school-logo-fallback" id="headerSchoolLogoFallback">${ICONS.logo()}</div>
            <img class="header-school-logo-img" id="headerSchoolLogoImg" style="display:none" alt="">
            <div class="header-school-text">
              <div class="header-school-name" id="headerSchoolName">...</div>
              <div class="header-school-branch" id="headerSchoolBranch">${escapeHtml(computeBranchLabel(APP.user))}</div>
            </div>
          </div>
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
  loadHeaderSchoolInfo();

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const openSidebarMobile = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };

  document.getElementById('menuToggleBtn').addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebarMobile() : openSidebarMobile();
  });
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebarMobile);
  overlay.addEventListener('click', closeSidebarMobile);

  // 🆕 طي/بسط القائمة الجانبية بسطح المكتب — يتذكّر اختيار المستخدم
  const collapseBtn = document.getElementById('sidebarCollapseBtn');
  if (localStorage.getItem('finance_sidebar_collapsed') === 'true') sidebar.classList.add('collapsed');
  collapseBtn.addEventListener('click', () => {
    const willCollapse = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', willCollapse);
    localStorage.setItem('finance_sidebar_collapsed', String(willCollapse));
  });

  // قائمة حساب المستخدم المنسدلة
  document.getElementById('headerUser').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('userDropdown').classList.toggle('show');
  });
  document.addEventListener('click', () => document.getElementById('userDropdown')?.classList.remove('show'));
  document.getElementById('dropdownLogoutBtn').addEventListener('click', doLogout);
  document.getElementById('openProfileInfoBtn').addEventListener('click', openMyProfileModal);
}

/** يجلب شعار المدرسة واسمها الحقيقيَّين (site_settings المركزي) — مرة واحدة فقط، تُخزَّن بذاكرة الجلسة */
async function loadHeaderSchoolInfo() {
  try {
    if (!APP.siteInfo) {
      APP.siteInfo = await apiCall('fee-settings', { method: 'POST', body: { action: 'getSiteInfo' }, requiresAuth: false });
    }
    document.getElementById('headerSchoolName').textContent = APP.siteInfo.schoolName || 'منصة مِرقاة';
    if (APP.siteInfo.logoUrl) {
      const img = document.getElementById('headerSchoolLogoImg');
      img.src = APP.siteInfo.logoUrl;
      img.onload = () => {
        img.style.display = 'block';
        document.getElementById('headerSchoolLogoFallback').style.display = 'none';
      };
    }
  } catch (e) {
    document.getElementById('headerSchoolName').textContent = 'منصة مِرقاة';
  }
}

function closeSidebarMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
  document.querySelector('#bottomNav a[data-bottom-key="more"]')?.classList.remove('active');
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
      const sidebar = document.getElementById('sidebar');
      if (sidebar.classList.contains('collapsed')) {
        // 🆕 القائمة مطويّة (أيقونات فقط) — بسّطها أولاً حتى تظهر عناصر المجموعة
        sidebar.classList.remove('collapsed');
        localStorage.setItem('finance_sidebar_collapsed', 'false');
      }
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
      if (key === 'more') {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const isOpen = sidebar.classList.contains('open');
        sidebar.classList.toggle('open', !isOpen);
        overlay.classList.toggle('show', !isOpen);
        a.classList.toggle('active', !isOpen);
        return;
      }
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

/* ===================== مساعدات مشتركة بين صفحات "الأشخاص" ===================== */

/** نفس أسلوب موقع الموظفين بالضبط — تحويل تقريبي (وليس ترجمة حقيقية) للاسم العربي لحروف إنجليزية،
 * كمقترح أولي فقط يقدر المستخدم يعدّله بأي وقت. */
const ARABIC_TO_LATIN_MAP_ = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'aa', 'ى': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th',
  'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z', 'س': 's',
  'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f',
  'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y',
  'ة': 'ah', 'ء': 'a', 'ئ': 'e', 'ؤ': 'o', ' ': ' ',
};
function transliterateArabicToEnglish(text) {
  const letters = text.trim().split('').map((ch) => ARABIC_TO_LATIN_MAP_[ch] ?? '').join('');
  return letters.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function collectCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector)).filter((el) => el.checked).map((el) => el.value);
}

function branchCheckboxesHtml(branches, selected, cls) {
  return branches.map((b) => `
    <label class="checkbox-item">
      <input type="checkbox" class="${cls}" value="${escapeHtml(b)}" ${selected.includes(b) ? 'checked' : ''}> ${escapeHtml(b)}
    </label>`).join('');
}

/** قائمة الفروع المركزية — تُجلَب مرة واحدة فقط طوال الجلسة */
async function getBranchesOnce() {
  if (!APP.allBranches) {
    APP.allBranches = await apiCall('fee-settings', { method: 'POST', body: { action: 'listBranches' } });
  }
  return APP.allBranches;
}

const FINANCE_STAFF_ROLE_OPTIONS_ = [
  { v: 'role_finance_admin', l: 'أدمن الإدارة المالية' },
  { v: 'role_accountant', l: 'محاسب' },
  { v: 'role_collection_monitor', l: 'مراقب الفروع والتحصيل' },
];

/** يجلب قائمة موظفي المالية — تُستخدَم من صفحتَي "موظفو المالية" و"المستخدمون" معاً (نفس الإجراء بالباك إند) */
async function loadFinanceStaffList() {
  APP.allFinanceStaff = await apiCall('finance-staff', { method: 'POST', body: { action: 'list' } });
}

/* ===================== صفحة موظفي المالية (إضافة/تعديل/حذف) ===================== */

async function renderFinanceStaffView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="card"><div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div></div>`;

  let branches;
  try {
    branches = await getBranchesOnce();
  } catch (e) {
    main.innerHTML = `<div class="card"><p style="color:#C4483A">${escapeHtml(e.message)}</p></div>`;
    return;
  }

  main.innerHTML = `
    <button type="button" class="btn-toggle-form" id="toggleStaffFormBtn">${ICONS.plus()} إضافة موظف مالية جديد</button>
    <div class="card" id="staffFormCard" style="display:none">
      <h2 id="staffFormTitle">إضافة موظف مالية جديد</h2>
      <p style="color:#888;font-size:12.5px;margin-top:-10px">* الاسم والدور والفرع إجبارية</p>
      <form id="addStaffForm">
        <input type="hidden" id="staff_editId" value="">
        <div class="field"><label>الاسم بالعربي *</label><input id="staff_nameAr" type="text" required></div>
        <div class="field"><label>الاسم بالإنجليزي <span style="font-weight:400;color:#888;font-size:11.5px">(تحويل تقريبي تلقائي، قابل للتعديل)</span></label><input id="staff_nameEn" type="text"></div>
        <div class="field" id="staff_nationalIdField"><label>رقم الهوية/الإقامة *</label><input id="staff_nationalId" type="text" maxlength="20" required></div>
        <div class="field"><label>الدور *</label>
          <select id="staff_role" required>
            <option value="" disabled selected>-- اختر الدور --</option>
            ${FINANCE_STAFF_ROLE_OPTIONS_.map((o) => `<option value="${o.v}">${escapeHtml(o.l)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>الجنس</label>
          <select id="staff_gender"><option value="">-- غير محدَّد --</option><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option></select>
        </div>
        <div class="filter-card-title">الفرع/الفروع * (يمكن اختيار أكثر من فرع لمراقب الفروع والتحصيل)</div>
        <div class="checkbox-list" id="staff_branchesBox">${branchCheckboxesHtml(branches, [], 'staff-branch-cb')}</div>

        <button type="submit" id="addStaffBtn" style="margin-top:14px">إضافة الموظف</button>
        <button type="button" id="cancelStaffEditBtn" style="display:none;background:#888;margin-top:8px">إلغاء التعديل</button>
      </form>
    </div>

    <div class="card">
      <h3>قائمة موظفي المالية</h3>
      <div class="field"><label>بحث بالاسم أو الدور أو الفرع</label><input id="staffSearchInput" type="text"></div>
      <div id="staffListArea"><div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div></div>
    </div>`;

  document.getElementById('toggleStaffFormBtn').addEventListener('click', () => {
    const card = document.getElementById('staffFormCard');
    const willShow = card.style.display === 'none';
    card.style.display = willShow ? 'block' : 'none';
    document.getElementById('toggleStaffFormBtn').innerHTML = willShow ? `${ICONS.close()} إغلاق النموذج` : `${ICONS.plus()} إضافة موظف مالية جديد`;
    if (!willShow) resetStaffForm();
  });

  document.getElementById('staff_nameAr').addEventListener('blur', () => {
    const enField = document.getElementById('staff_nameEn');
    if (!enField.value.trim()) enField.value = transliterateArabicToEnglish(document.getElementById('staff_nameAr').value);
  });

  document.getElementById('addStaffForm').addEventListener('submit', saveStaffHandler);
  document.getElementById('cancelStaffEditBtn').addEventListener('click', resetStaffForm);
  document.getElementById('staffSearchInput').addEventListener('input', renderStaffTable);

  try {
    await loadFinanceStaffList();
    renderStaffTable();
  } catch (e) {
    document.getElementById('staffListArea').innerHTML = `<p style="color:#C4483A">${escapeHtml(e.message)}</p>`;
  }
}

function resetStaffForm() {
  document.getElementById('addStaffForm').reset();
  document.getElementById('staff_editId').value = '';
  document.getElementById('staff_nationalIdField').style.display = 'block';
  document.getElementById('staff_nationalId').required = true;
  document.getElementById('staffFormTitle').textContent = 'إضافة موظف مالية جديد';
  document.getElementById('addStaffBtn').textContent = 'إضافة الموظف';
  document.getElementById('cancelStaffEditBtn').style.display = 'none';
  document.querySelectorAll('.staff-branch-cb').forEach((cb) => { cb.checked = false; });
  document.getElementById('staffFormCard').style.display = 'none';
  document.getElementById('toggleStaffFormBtn').innerHTML = `${ICONS.plus()} إضافة موظف مالية جديد`;
}

function startEditStaff(emp) {
  document.getElementById('staffFormCard').style.display = 'block';
  document.getElementById('toggleStaffFormBtn').innerHTML = `${ICONS.close()} إغلاق النموذج`;
  document.getElementById('staff_editId').value = emp.id;
  document.getElementById('staff_nameAr').value = emp.nameAr;
  document.getElementById('staff_nameEn').value = emp.nameEn || '';
  document.getElementById('staff_nationalIdField').style.display = 'none'; // لا يُعدَّل رقم الهوية بعد الإنشاء
  document.getElementById('staff_nationalId').required = false;
  document.getElementById('staff_role').value = emp.role;
  document.getElementById('staff_gender').value = emp.gender || '';
  document.querySelectorAll('.staff-branch-cb').forEach((cb) => { cb.checked = emp.allBranches.includes(cb.value); });

  document.getElementById('staffFormTitle').textContent = 'تعديل بيانات: ' + emp.nameAr;
  document.getElementById('addStaffBtn').textContent = 'حفظ التعديلات';
  document.getElementById('cancelStaffEditBtn').style.display = 'inline-block';
  document.getElementById('staffFormCard').scrollIntoView({ behavior: 'smooth' });
}

async function saveStaffHandler(e) {
  e.preventDefault();
  const editId = document.getElementById('staff_editId').value;
  const btn = document.getElementById('addStaffBtn');

  const branches = collectCheckedValues('.staff-branch-cb');
  if (!branches.length) { showToast('اختر فرعاً واحداً على الأقل', 'error'); return; }

  const body = {
    nameAr: document.getElementById('staff_nameAr').value.trim(),
    nameEn: document.getElementById('staff_nameEn').value.trim(),
    role: document.getElementById('staff_role').value,
    gender: document.getElementById('staff_gender').value,
    branches,
  };
  if (!editId) body.nationalId = document.getElementById('staff_nationalId').value.trim();

  btn.disabled = true; btn.textContent = 'جارِ الحفظ...';
  try {
    if (editId) {
      await apiCall('finance-staff', { method: 'POST', body: { action: 'update', id: editId, ...body } });
      showToast('تم تحديث بيانات الموظف بنجاح', 'success');
    } else {
      await apiCall('finance-staff', { method: 'POST', body: { action: 'add', ...body } });
      showToast('تم إضافة الموظف بنجاح — كلمة المرور المبدئية هي رقم الهوية', 'success');
    }
    resetStaffForm();
    await loadFinanceStaffList();
    renderStaffTable();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = editId ? 'حفظ التعديلات' : 'إضافة الموظف';
  }
}

function renderStaffTable() {
  const area = document.getElementById('staffListArea');
  const q = (document.getElementById('staffSearchInput').value || '').trim().toLowerCase();
  const list = (APP.allFinanceStaff || []).filter((e) => {
    if (!q) return true;
    return e.nameAr.toLowerCase().includes(q) ||
      (ROLE_LABELS_AR[e.role] || e.role).toLowerCase().includes(q) ||
      e.allBranches.some((b) => b.toLowerCase().includes(q));
  });

  if (!list.length) { area.innerHTML = '<p style="color:#888">لا يوجد موظفو مالية مطابقون</p>'; return; }

  area.innerHTML = `<div class="person-card-grid">${list.map((e) => `
    <div class="person-card">
      <div class="person-card-header">
        <span class="person-avatar">${escapeHtml((e.nameAr || '؟').trim().charAt(0))}</span>
        <div class="person-card-info">
          <div class="person-card-name">${escapeHtml(e.nameAr)}</div>
          <div class="person-card-role">${escapeHtml(ROLE_LABELS_AR[e.role] || e.role)}</div>
        </div>
      </div>
      <div class="person-card-body">
        <div class="person-card-row"><span>الفروع</span><span>${escapeHtml(e.allBranches.join('، '))}</span></div>
      </div>
      <div class="person-card-footer">
        <div class="person-card-actions">
          <button type="button" class="btn-icon-edit" data-id="${escapeHtml(e.id)}">${ICONS.edit()}</button>
          <button type="button" class="btn-icon-delete" data-id="${escapeHtml(e.id)}" data-name="${escapeHtml(e.nameAr)}">${ICONS.trash()}</button>
        </div>
      </div>
    </div>`).join('')}</div>`;

  area.querySelectorAll('.btn-icon-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emp = APP.allFinanceStaff.find((x) => x.id === btn.getAttribute('data-id'));
      if (emp) startEditStaff(emp);
    });
  });
  area.querySelectorAll('.btn-icon-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.getAttribute('data-name');
      if (!confirm(`تأكيد حذف الموظف "${name}"؟ سيُعطَّل حسابه فوراً.`)) return;
      try {
        await apiCall('finance-staff', { method: 'POST', body: { action: 'delete', id: btn.getAttribute('data-id') } });
        showToast('تم حذف الموظف بنجاح', 'success');
        await loadFinanceStaffList();
        renderStaffTable();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}

/* ===================== صفحة المستخدمين (إدارة الحسابات: تفعيل/تعطيل/إعادة تعيين كلمة مرور) ===================== */

async function renderUsersView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="card"><div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div></div>`;

  main.innerHTML = `
    <div class="card">
      <h3>حسابات الدخول</h3>
      <p style="color:#888;font-size:12.5px;margin-top:-10px">لإضافة موظف جديد (وحسابه تلقائياً معه)، استخدم صفحة "موظفو المالية"</p>
      <div class="field"><label>بحث بالاسم أو اسم المستخدم</label><input id="userSearchInput" type="text"></div>
      <div id="usersListArea"><div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div></div>
    </div>`;

  document.getElementById('userSearchInput').addEventListener('input', renderUsersTable);

  try {
    await loadFinanceStaffList();
    renderUsersTable();
  } catch (e) {
    document.getElementById('usersListArea').innerHTML = `<p style="color:#C4483A">${escapeHtml(e.message)}</p>`;
  }
}

function renderUsersTable() {
  const area = document.getElementById('usersListArea');
  const q = (document.getElementById('userSearchInput').value || '').trim().toLowerCase();
  const list = (APP.allFinanceStaff || []).filter((u) => !q || u.nameAr.toLowerCase().includes(q) || u.nationalId.toLowerCase().includes(q));

  if (!list.length) { area.innerHTML = '<p style="color:#888">لا توجد حسابات مطابقة</p>'; return; }

  area.innerHTML = `<div class="person-card-grid">${list.map((u) => {
    const isActive = u.status === 'active';
    return `
    <div class="person-card" data-id="${escapeHtml(u.id)}" data-card-clickable>
      <div class="person-card-header">
        <span class="person-avatar">${escapeHtml((u.nameAr || '؟').trim().charAt(0))}</span>
        <div class="person-card-info">
          <div class="person-card-name">${escapeHtml(u.nameAr)}</div>
          <div class="person-card-role">${escapeHtml(ROLE_LABELS_AR[u.role] || u.role)}</div>
        </div>
        <span class="status-badge ${isActive ? 'status-badge-on' : 'status-badge-off'}">
          <span class="status-dot ${isActive ? 'status-dot-on' : 'status-dot-off'}"></span>${isActive ? 'مفعَّل' : 'معطَّل'}
        </span>
      </div>
      <div class="person-card-body">
        <div class="person-card-row"><span>اسم المستخدم</span><span>${escapeHtml(u.nationalId)}</span></div>
        <div class="person-card-row"><span>آخر دخول</span><span>${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('ar') : 'لم يسجّل بعد'}</span></div>
      </div>
      <div class="person-card-footer">
        <div class="person-card-actions">
          <button type="button" class="btn-outline-sm ${isActive ? 'btn-danger-outline' : ''}" data-id="${escapeHtml(u.id)}" data-new-status="${isActive ? 'inactive' : 'active'}">
            ${isActive ? 'تعطيل' : 'تفعيل'}
          </button>
          <button type="button" class="btn-reset-staff-pass btn-outline-sm" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.nameAr)}">${ICONS.key()} إعادة تعيين</button>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;

  area.querySelectorAll('[data-card-clickable]').forEach((card) => {
    card.addEventListener('click', (evt) => {
      if (evt.target.closest('button')) return; // الأزرار لها معالجاتها الخاصة، لا تفتح النافذة كمان
      const u = APP.allFinanceStaff.find((x) => x.id === card.getAttribute('data-id'));
      if (!u) return;
      showDetailModal(u.nameAr, ROLE_LABELS_AR[u.role] || u.role, [
        { label: 'اسم المستخدم', value: u.nationalId },
        { label: 'الدور (الصلاحية)', value: ROLE_LABELS_AR[u.role] || u.role },
        { label: 'الفروع', value: u.allBranches.join('، ') },
        { label: 'حالة الحساب', value: u.status === 'active' ? 'مفعَّل' : 'معطَّل' },
        { label: 'آخر دخول', value: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ar') : null },
        { label: 'تاريخ الإنشاء', value: u.createdAt ? new Date(u.createdAt).toLocaleDateString('ar') : null },
      ]);
    });
  });

  area.querySelectorAll('[data-new-status]').forEach((btn) => {
    btn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      const newStatus = btn.getAttribute('data-new-status');
      if (!confirm(newStatus === 'active' ? 'تأكيد تفعيل هذا الحساب؟' : 'تأكيد تعطيل هذا الحساب؟')) return;
      try {
        await apiCall('finance-staff', { method: 'POST', body: { action: 'toggleStatus', id: btn.getAttribute('data-id'), newStatus } });
        showToast(newStatus === 'active' ? 'تم التفعيل' : 'تم التعطيل', 'success');
        await loadFinanceStaffList();
        renderUsersTable();
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });

  area.querySelectorAll('.btn-reset-staff-pass').forEach((btn) => {
    btn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      const name = btn.getAttribute('data-name');
      if (!confirm(`إعادة تعيين كلمة مرور "${name}" لرقم هويته الأصلي؟`)) return;
      try {
        const result = await apiCall('finance-staff', { method: 'POST', body: { action: 'resetPassword', id: btn.getAttribute('data-id') } });
        showToast('تمت إعادة التعيين — كلمة المرور الجديدة: ' + result.tempPassword, 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}
