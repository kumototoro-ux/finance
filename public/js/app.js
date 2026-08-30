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
  students: { label: 'الطلاب', icon: 'students', render: renderStudentsView },
  invoices: { label: 'الفواتير', icon: 'invoice', render: comingSoonRender('الفواتير') },
  payments: { label: 'الدفعات', icon: 'payment', render: comingSoonRender('الدفعات') },
  collection: { label: 'التحصيل والرقابة', icon: 'branches', render: comingSoonRender('التحصيل والرقابة') },
  reconciliation: { label: 'المطابقة المالية', icon: 'reconciliation', render: comingSoonRender('المطابقة المالية') },
  financialPeriods: { label: 'الفترات المالية', icon: 'period', render: comingSoonRender('الفترات المالية') },
  revenuesExpenses: { label: 'الإيرادات والمصروفات', icon: 'revenue', render: comingSoonRender('الإيرادات والمصروفات') },
  payroll: { label: 'الرواتب', icon: 'payroll', render: comingSoonRender('الرواتب') },
  financeStaff: { label: 'موظفو المالية', icon: 'staff', render: renderFinanceStaffView },
  users: { label: 'المستخدمون', icon: 'users', render: renderUsersView },
  feeSettings: { label: 'الإعدادات', icon: 'settings', render: renderFeeSettingsView },
  auditLog: { label: 'سجل التدقيق', icon: 'audit', render: renderAuditLogView },
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

/** نافذة تأكيد احترافية — بديل كامل عن confirm() الافتراضية بالمتصفح.
 * تُرجع Promise<boolean> — true لو ضغط "موافق"، false لو "إلغاء" أو أغلقها. */
function showConfirmModal(message, confirmLabel, cancelLabel) {
  confirmLabel = confirmLabel || 'موافق';
  cancelLabel = cancelLabel || 'إلغاء';
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:360px">
        <div class="modal-body" style="padding:28px 22px 22px;text-align:center">
          <p style="font-size:14.5px;font-weight:700;color:var(--primary);margin:0 0 22px;line-height:1.6">${escapeHtml(message)}</p>
          <div style="display:flex;gap:10px">
            <button type="button" id="confirmModalCancelBtn" class="btn-outline-sm" style="flex:1;justify-content:center;padding:11px">${escapeHtml(cancelLabel)}</button>
            <button type="button" id="confirmModalOkBtn" style="flex:1">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    document.getElementById('confirmModalOkBtn').addEventListener('click', () => close(true));
    document.getElementById('confirmModalCancelBtn').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

/** نافذة نموذج عامة — نفس شكل showDetailModal لكن بمحتوى HTML خام (نماذج تفاعلية). */
function showFormModal(title, subtitle, bodyHtml, extraClass) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card ${extraClass || ''}">
      <div class="modal-header">
        <div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}</div>
        <button type="button" class="modal-close-btn" id="formModalCloseBtn">${ICONS.close()}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('formModalCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  return { overlay, close };
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function todayISODate() { return new Date().toISOString().slice(0, 10); }

/** طباعة أي مستند (سند/كشف حساب) بنافذة منفصلة نظيفة — بلا تداخل مع تصميم الموقع الأساسي */
function printHtmlDocument(innerHtml, title) {
  const win = window.open('', '_blank');
  if (!win) { showToast('يرجى السماح بالنوافذ المنبثقة بالمتصفح للطباعة', 'error'); return; }
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${title}</title>
    <style>body{margin:0;padding:24px;background:#fff}@media print{body{padding:0}}</style></head>
    <body>${innerHtml}</body></html>`);
  win.document.close();
  win.focus();
  // تأخير بسيط لضمان تحميل شعار المدرسة (صورة) قبل استدعاء الطباعة
  setTimeout(() => { win.print(); }, 400);
}

/** تنزيل عنصر HTML كملف PDF حقيقي عالي الجودة (html2pdf.js — Canvas مضاعف الدقة) */
async function downloadHtmlAsPdf(element, filename) {
  showToast('جارِ تجهيز الملف...', 'success');
  try {
    await html2pdf().set({
      margin: 8, filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(element).save();
  } catch (e) {
    showToast('تعذّر إنشاء الملف: ' + e.message, 'error');
  }
}

/** مشاركة عنصر HTML كملف PDF عبر Web Share API (واتساب وأي تطبيق آخر يدعم استقبال ملفات) */
async function shareHtmlAsPdf(element, filename, title) {
  try {
    const pdfBlob = await html2pdf().set({
      margin: 8, image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(element).outputPdf('blob');
    const file = new File([pdfBlob], `${filename}.pdf`, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
    } else {
      showToast('المشاركة المباشرة غير مدعومة بهذا المتصفح — حمِّل الملف ثم شاركه يدوياً', 'error');
    }
  } catch (e) {
    if (e.name !== 'AbortError') showToast('تعذّرت المشاركة: ' + e.message, 'error');
  }
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

/** قائمة الصفوف المركزية — تُجلَب مرة واحدة فقط طوال الجلسة */
async function getGradesOnce() {
  if (!APP.allGrades) {
    APP.allGrades = await apiCall('fee-settings', { method: 'POST', body: { action: 'listGrades' } });
  }
  return APP.allGrades;
}

/** قائمة الشعب المركزية — تُجلَب مرة واحدة فقط طوال الجلسة */
async function getSectionsOnce() {
  if (!APP.allSections) {
    APP.allSections = await apiCall('fee-settings', { method: 'POST', body: { action: 'listSections' } });
  }
  return APP.allSections;
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
    <div class="person-card" data-id="${escapeHtml(e.id)}" data-card-clickable>
      <div class="person-card-header">
        <span class="person-avatar">${escapeHtml((e.nameAr || '؟').trim().charAt(0))}</span>
        <div class="person-card-info">
          <div class="person-card-name">${escapeHtml(e.nameAr)}</div>
          <div class="person-card-role">${escapeHtml(ROLE_LABELS_AR[e.role] || e.role)}</div>
        </div>
      </div>
      <div class="person-card-body">
        <div class="person-card-row"><span>رقم الهوية</span><span>${escapeHtml(e.nationalId)}</span></div>
      </div>
      <div class="person-card-footer">
        <div class="person-card-actions">
          <button type="button" class="btn-icon-edit" data-id="${escapeHtml(e.id)}">${ICONS.edit()}</button>
          <button type="button" class="btn-icon-delete" data-id="${escapeHtml(e.id)}" data-name="${escapeHtml(e.nameAr)}">${ICONS.trash()}</button>
        </div>
      </div>
    </div>`).join('')}</div>`;

  // 🆕 الضغط على جسم البطاقة (بعيداً عن أزرار التعديل/الحذف) يفتح تفاصيل كاملة — الفروع كلها هنا فقط، مو بواجهة القائمة
  area.querySelectorAll('[data-card-clickable]').forEach((card) => {
    card.addEventListener('click', (evt) => {
      if (evt.target.closest('button')) return;
      const emp = APP.allFinanceStaff.find((x) => x.id === card.getAttribute('data-id'));
      if (!emp) return;
      showDetailModal(emp.nameAr, ROLE_LABELS_AR[emp.role] || emp.role, [
        { label: 'رقم الهوية', value: emp.nationalId },
        { label: 'الدور (الصلاحية)', value: ROLE_LABELS_AR[emp.role] || emp.role },
        { label: 'الجنس', value: emp.gender },
        { label: 'الفروع', value: emp.allBranches.join('، ') },
        { label: 'حالة الحساب', value: emp.status === 'active' ? 'مفعَّل' : 'معطَّل' },
        { label: 'تاريخ الإضافة', value: emp.createdAt ? new Date(emp.createdAt).toLocaleDateString('ar') : null },
      ]);
    });
  });

  area.querySelectorAll('.btn-icon-edit').forEach((btn) => {
    btn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const emp = APP.allFinanceStaff.find((x) => x.id === btn.getAttribute('data-id'));
      if (emp) startEditStaff(emp);
    });
  });
  area.querySelectorAll('.btn-icon-delete').forEach((btn) => {
    btn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      const name = btn.getAttribute('data-name');
      if (!(await showConfirmModal(`تأكيد حذف الموظف "${name}"؟ سيُعطَّل حسابه فوراً.`, 'حذف', 'إلغاء'))) return;
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
      if (!(await showConfirmModal(newStatus === 'active' ? 'تأكيد تفعيل هذا الحساب؟' : 'تأكيد تعطيل هذا الحساب؟'))) return;
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
      if (!(await showConfirmModal(`إعادة تعيين كلمة مرور "${name}" لرقم هويته الأصلي؟`, 'إعادة التعيين', 'إلغاء'))) return;
      try {
        const result = await apiCall('finance-staff', { method: 'POST', body: { action: 'resetPassword', id: btn.getAttribute('data-id') } });
        showToast('تمت إعادة التعيين — كلمة المرور الجديدة: ' + result.tempPassword, 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  });
}

/* ===================== صفحة الإعدادات الموحَّدة (شريط جانبي داخلي + محتوى) ===================== */
// 🆕 نفس فلسفة إعدادات موقع الموظفين بالضبط: قائمة تصنيفات يسار، محتوى القسم المُختار يمين.
// كل الأقسام هنا محصورة أصلاً بأدمن عام/أدمن مالية فقط (عبر ROLE_PAGES).

const FIN_SETTINGS_SECTIONS_ = [
  { key: 'feeItems', label: 'بنود الرسوم', icon: 'invoice' },
  { key: 'expenseCategories', label: 'تصنيفات المصروفات', icon: 'revenue' },
  { key: 'paymentMethods', label: 'طرق الدفع', icon: 'payment' },
  { key: 'accounts', label: 'الحسابات المالية', icon: 'branches' },
  { key: 'feeStructure', label: 'رسوم الفروع والصفوف', icon: 'period' },
];

let financeSettingsActiveSection_ = 'feeItems';
let feeStructureFilters_ = { academicYear: '', termId: '', branch: '' };

async function renderFeeSettingsView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="settings-shell">
      <nav class="settings-nav">
        ${FIN_SETTINGS_SECTIONS_.map((s) => `
          <button type="button" class="settings-nav-item ${s.key === financeSettingsActiveSection_ ? 'active' : ''}" data-fin-section="${s.key}">
            ${ICONS[s.icon]()}<span>${escapeHtml(s.label)}</span>
          </button>`).join('')}
      </nav>
      <div class="settings-content" id="finSettingsContent"></div>
    </div>`;

  document.querySelectorAll('[data-fin-section]').forEach((btn) => {
    btn.addEventListener('click', () => { financeSettingsActiveSection_ = btn.getAttribute('data-fin-section'); renderFinSettingsSection(); });
  });

  renderFinSettingsSection();
}

async function renderFinSettingsSection() {
  document.querySelectorAll('[data-fin-section]').forEach((b) => b.classList.toggle('active', b.getAttribute('data-fin-section') === financeSettingsActiveSection_));
  const content = document.getElementById('finSettingsContent');
  content.innerHTML = `<div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div>`;

  try {
    if (financeSettingsActiveSection_ === 'feeItems') {
      await renderLookupSection_(content, { listAction: 'listFeeItems', addAction: 'addFeeItem', toggleAction: 'toggleFeeItemActive', label: 'بند رسوم' });
    } else if (financeSettingsActiveSection_ === 'expenseCategories') {
      await renderLookupSection_(content, { listAction: 'listExpenseCategories', addAction: 'addExpenseCategory', toggleAction: 'toggleExpenseCategoryActive', label: 'تصنيف مصروف' });
    } else if (financeSettingsActiveSection_ === 'paymentMethods') {
      await renderLookupSection_(content, { listAction: 'listPaymentMethods', addAction: 'addPaymentMethod', toggleAction: 'togglePaymentMethodActive', label: 'طريقة دفع' });
    } else if (financeSettingsActiveSection_ === 'accounts') {
      await renderAccountsSection_(content);
    } else if (financeSettingsActiveSection_ === 'feeStructure') {
      await renderFeeStructureSection_(content);
    }
  } catch (e) {
    content.innerHTML = `<p style="color:#C4483A">${escapeHtml(e.message)}</p>`;
  }
}

/** قسم عام لأي قائمة مرجعية بسيطة (بند رسوم / تصنيف مصروف / طريقة دفع) — إضافة + تفعيل/تعطيل عبر شرائح */
async function renderLookupSection_(content, cfg) {
  const items = await apiCall('fee-settings', { method: 'POST', body: { action: cfg.listAction } });

  content.innerHTML = `
    <h2 style="margin-top:0">${escapeHtml(cfg.label)} — إضافة وإدارة</h2>
    <p style="color:#888;font-size:12.5px;margin-top:-10px">تعطيل عنصر لا يحذفه من السجلات القديمة — فقط يختفي من هذي القائمة وأي قائمة اختيار جديدة</p>
    <div class="chip-input-wrap"><input type="text" id="lookupAddInput" placeholder="أضف ${escapeHtml(cfg.label)} جديد..."></div>
    <button type="button" id="lookupAddBtn" style="margin-top:10px">إضافة</button>
    <div class="chip-list" id="lookupChipList" style="margin-top:18px"></div>
    <div id="lookupShowInactiveWrap" style="margin-top:12px"></div>`;

  let showInactive = false;

  function renderInactiveToggle() {
    const inactiveCount = items.filter((i) => !i.is_active).length;
    const wrap = document.getElementById('lookupShowInactiveWrap');
    if (!inactiveCount) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `<button type="button" id="toggleInactiveBtn" class="btn-outline-sm">${showInactive ? 'إخفاء' : 'إظهار'} العناصر المعطَّلة (${inactiveCount})</button>`;
    document.getElementById('toggleInactiveBtn').addEventListener('click', () => { showInactive = !showInactive; renderChips(); renderInactiveToggle(); });
  }

  function renderChips() {
    const box = document.getElementById('lookupChipList');
    const visibleItems = showInactive ? items : items.filter((i) => i.is_active);
    box.innerHTML = visibleItems.length ? visibleItems.map((it) => `
      <span class="chip ${it.is_active ? '' : 'chip-inactive'}">
        ${escapeHtml(it.name)}
        <span class="chip-remove" data-toggle-id="${it.id}" data-active="${it.is_active}" title="${it.is_active ? 'تعطيل' : 'إعادة تفعيل'}">${it.is_active ? ICONS.close() : ICONS.plus()}</span>
      </span>`).join('') : '<span class="chip-empty">لا توجد عناصر مُفعَّلة حالياً</span>';

    box.querySelectorAll('[data-toggle-id]').forEach((el) => {
      el.addEventListener('click', async () => {
        const isActive = el.getAttribute('data-active') === 'true';
        if (!(await showConfirmModal(isActive ? 'تعطيل هذا العنصر؟ سيختفي من كل القوائم الجديدة.' : 'إعادة تفعيل هذا العنصر؟', isActive ? 'تعطيل' : 'تفعيل'))) return;
        try {
          await apiCall('fee-settings', { method: 'POST', body: { action: cfg.toggleAction, id: el.getAttribute('data-toggle-id'), isActive: !isActive } });
          const item = items.find((i) => String(i.id) === el.getAttribute('data-toggle-id'));
          if (item) item.is_active = !isActive;
          renderChips();
          renderInactiveToggle();
          showToast(isActive ? 'تم التعطيل بنجاح' : 'تم التفعيل بنجاح', 'success');
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
  }
  renderChips();
  renderInactiveToggle();

  document.getElementById('lookupAddBtn').addEventListener('click', async () => {
    const val = document.getElementById('lookupAddInput').value.trim();
    if (!val) return;
    try {
      await apiCall('fee-settings', { method: 'POST', body: { action: cfg.addAction, name: val } });
      showToast('تم الحفظ بنجاح', 'success');
      await renderFinSettingsSection();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

/** قسم الحسابات المالية — إضافة/تعديل/تعطيل */
async function renderAccountsSection_(content) {
  const [branches, accounts] = await Promise.all([
    getBranchesOnce(),
    apiCall('fee-settings', { method: 'POST', body: { action: 'listAccounts' } }),
  ]);

  content.innerHTML = `
    <h2 style="margin-top:0">الحسابات المالية</h2>
    <form id="accForm">
      <input type="hidden" id="acc_editId">
      <div class="field"><label>اسم الحساب *</label><input id="acc_name" type="text" required></div>
      <div class="field"><label>النوع *</label>
        <select id="acc_type" required><option value="bank">بنكي</option><option value="cash">نقدي</option><option value="other">أخرى</option></select>
      </div>
      <div class="field"><label>الفرع (اتركه فارغاً لحساب عام لكل الفروع)</label>
        <select id="acc_branch"><option value="">-- عام لكل الفروع --</option>${branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>رقم الحساب</label><input id="acc_number" type="text"></div>
      <button type="submit" id="acc_submitBtn">إضافة الحساب</button>
      <button type="button" id="acc_cancelBtn" style="display:none;background:#888;margin-top:8px">إلغاء التعديل</button>
    </form>
    <hr style="margin:24px 0;border-color:var(--outline)">
    <h3>الحسابات الحالية</h3>
    <div id="accListArea"></div>`;

  function renderAccList() {
    const area = document.getElementById('accListArea');
    const TYPE_LABELS = { bank: 'بنكي', cash: 'نقدي', other: 'أخرى' };
    area.innerHTML = accounts.length ? accounts.map((a) => `
      <div class="person-card-row" style="padding:10px 0;border-bottom:1px solid var(--surface)">
        <div>
          <div style="font-weight:700;font-size:13px">${escapeHtml(a.name)}${a.is_active ? '' : ' (معطَّل)'}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${TYPE_LABELS[a.account_type]} — ${escapeHtml(a.branch || 'كل الفروع')}${a.account_number ? ' — ' + escapeHtml(a.account_number) : ''}</div>
        </div>
        <span style="display:flex;gap:10px;flex-shrink:0">
          <span data-edit-acc="${a.id}" style="cursor:pointer;color:var(--primary)">${ICONS.edit()}</span>
          <span data-toggle-acc="${a.id}" data-active="${a.is_active}" style="cursor:pointer;color:${a.is_active ? '#C4483A' : '#2F7A4D'}">${a.is_active ? ICONS.trash() : ICONS.plus()}</span>
        </span>
      </div>`).join('') : '<p style="color:#888">لا توجد حسابات بعد</p>';

    area.querySelectorAll('[data-edit-acc]').forEach((el) => {
      el.addEventListener('click', () => {
        const acc = accounts.find((x) => String(x.id) === el.getAttribute('data-edit-acc'));
        document.getElementById('acc_editId').value = acc.id;
        document.getElementById('acc_name').value = acc.name;
        document.getElementById('acc_type').value = acc.account_type;
        document.getElementById('acc_branch').value = acc.branch || '';
        document.getElementById('acc_number').value = acc.account_number || '';
        document.getElementById('acc_submitBtn').textContent = 'حفظ التعديلات';
        document.getElementById('acc_cancelBtn').style.display = 'inline-block';
        document.getElementById('accForm').scrollIntoView({ behavior: 'smooth' });
      });
    });
    area.querySelectorAll('[data-toggle-acc]').forEach((el) => {
      el.addEventListener('click', async () => {
        const isActive = el.getAttribute('data-active') === 'true';
        if (!(await showConfirmModal(isActive ? 'تعطيل هذا الحساب؟' : 'إعادة تفعيل هذا الحساب؟', isActive ? 'تعطيل' : 'تفعيل'))) return;
        try {
          await apiCall('fee-settings', { method: 'POST', body: { action: 'toggleAccountActive', id: el.getAttribute('data-toggle-acc'), isActive: !isActive } });
          showToast(isActive ? 'تم التعطيل بنجاح' : 'تم التفعيل بنجاح', 'success');
          await renderFinSettingsSection();
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    });
  }
  renderAccList();

  document.getElementById('acc_cancelBtn').addEventListener('click', () => {
    document.getElementById('accForm').reset();
    document.getElementById('acc_editId').value = '';
    document.getElementById('acc_submitBtn').textContent = 'إضافة الحساب';
    document.getElementById('acc_cancelBtn').style.display = 'none';
  });

  document.getElementById('accForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('acc_editId').value;
    const btn = document.getElementById('acc_submitBtn');
    const body = {
      name: document.getElementById('acc_name').value.trim(),
      accountType: document.getElementById('acc_type').value,
      branch: document.getElementById('acc_branch').value,
      accountNumber: document.getElementById('acc_number').value.trim(),
    };
    btn.disabled = true; btn.textContent = 'جارِ الحفظ...';
    try {
      if (editId) {
        await apiCall('fee-settings', { method: 'POST', body: { action: 'updateAccount', id: editId, ...body } });
        showToast('تم تحديث الحساب بنجاح', 'success');
      } else {
        await apiCall('fee-settings', { method: 'POST', body: { action: 'addAccount', ...body } });
        showToast('تمت إضافة الحساب بنجاح', 'success');
      }
      await renderFinSettingsSection();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.textContent = editId ? 'حفظ التعديلات' : 'إضافة الحساب';
    }
  });
}

/** 🆕 القسم الأهم — التحكم برسوم كل فرع لكل صف (بندك المطلوب صراحة) */
async function renderFeeStructureSection_(content) {
  const [branches, terms, grades, feeItemsList] = await Promise.all([
    getBranchesOnce(),
    apiCall('fee-settings', { method: 'POST', body: { action: 'listAcademicTerms' } }),
    apiCall('fee-settings', { method: 'POST', body: { action: 'listGrades' } }),
    apiCall('fee-settings', { method: 'POST', body: { action: 'listFeeItems' } }),
  ]);
  const activeFeeItems = feeItemsList.filter((i) => i.is_active);

  if (!terms.length) {
    content.innerHTML = `<h2 style="margin-top:0">رسوم الفروع والصفوف</h2><p style="color:#888">لا توجد فصول دراسية مُعرَّفة بعد بموقع الموظفين — أضِف فصلاً دراسياً هناك أولاً</p>`;
    return;
  }
  if (!activeFeeItems.length) {
    content.innerHTML = `<h2 style="margin-top:0">رسوم الفروع والصفوف</h2><p style="color:#888">لا توجد بنود رسوم مُفعَّلة بعد — أضِفها أولاً من قسم "بنود الرسوم"</p>`;
    return;
  }

  content.innerHTML = `
    <h2 style="margin-top:0">رسوم الفروع والصفوف</h2>
    <p style="color:#888;font-size:12.5px;margin-top:-10px">حدِّد العام والفصل الدراسي أولاً (يُستخدَمان بالقسمين أسفله معاً)</p>
    <div class="field"><label>العام الدراسي *</label><input type="text" id="fs_sharedYear" placeholder="مثال: 2025-2026" value="${escapeHtml(feeStructureFilters_.academicYear)}"></div>
    <label class="checkbox-item" style="margin-bottom:16px"><input type="checkbox" id="fsb_wholeYear"> عند التعيين أدناه: تطبيق على العام الدراسي كاملاً (كل الفصول دفعة واحدة)</label>
    <div class="field" id="fs_sharedTermField"><label>الفصل الدراسي *</label>
      <select id="fs_sharedTerm">${terms.map((t) => `<option value="${t.id}" ${String(t.id) === String(feeStructureFilters_.termId) ? 'selected' : ''}>${escapeHtml(t.academic_year)} — ${escapeHtml(t.name)}</option>`).join('')}</select>
    </div>

    <hr style="margin:24px 0;border-color:var(--outline)">

    <h3 style="margin-top:0">تعيين رسم جديد</h3>
    <p style="color:#888;font-size:12.5px;margin-top:-8px">اختر بند الرسم والمبلغ، ثم حدِّد أي نطاق يشمله — من الأعمّ (كل الفروع) للأخصّ (صف واحد بفرع واحد)</p>

    <div class="field"><label>بند الرسم *</label><select id="fsb_feeItem">${activeFeeItems.map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')}</select></div>
    <div class="field"><label>المبلغ (ريال) *</label><input type="number" min="0" step="0.01" id="fsb_amount" placeholder="0.00"></div>

    <div class="filter-card-title">نطاق التطبيق</div>
    <div class="checkbox-list" style="margin-bottom:16px">
      <label class="checkbox-item"><input type="radio" name="fsb_scope" value="global" checked> كل الفروع (نفس المبلغ للجميع)</label>
      <label class="checkbox-item"><input type="radio" name="fsb_scope" value="branch"> فرع كامل (كل صفوفه)</label>
      <label class="checkbox-item"><input type="radio" name="fsb_scope" value="stage"> مجموعة صفوف مختارة (مرحلة)</label>
      <label class="checkbox-item"><input type="radio" name="fsb_scope" value="grade"> صف واحد محدَّد</label>
    </div>

    <div class="field" id="fsb_branchField" style="display:none"><label>الفرع *</label><select id="fsb_branch">${branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}</select></div>
    <div id="fsb_gradesMultiBox" style="display:none">
      <div class="filter-card-title">اختر الصفوف المشمولة</div>
      <div class="checkbox-list">${branchCheckboxesHtml(grades, [], 'fsb-grade-cb')}</div>
    </div>
    <div class="field" id="fsb_gradeSingleField" style="display:none"><label>الصف *</label><select id="fsb_gradeSingle">${grades.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}</select></div>

    <button type="button" id="fsb_saveBtn" style="margin-top:14px">حفظ الرسم</button>

    <hr style="margin:28px 0;border-color:var(--outline)">

    <h3>عرض وتعديل الرسوم الحالية</h3>
    <p style="color:#888;font-size:12.5px;margin-top:-6px">اختر الفرع لمراجعة كل الصفوف بنفس العام والفصل أعلاه، وتعديل أي مبلغ بمفرده</p>
    <div class="field"><label>الفرع</label>
      <select id="fs_branch">${branches.map((b) => `<option value="${escapeHtml(b)}" ${b === feeStructureFilters_.branch ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('')}</select>
    </div>
    <button type="button" id="fs_loadBtn">تحميل الرسوم</button>
    <div id="fs_gradesArea" style="margin-top:20px"></div>`;

  document.getElementById('fsb_wholeYear').addEventListener('change', (e) => {
    document.getElementById('fs_sharedTermField').style.display = e.target.checked ? 'none' : 'block';
  });

  /* ---------- تفاعل نموذج التعيين الجديد ---------- */
  document.querySelectorAll('input[name="fsb_scope"]').forEach((r) => {
    r.addEventListener('change', () => {
      const scope = document.querySelector('input[name="fsb_scope"]:checked').value;
      document.getElementById('fsb_branchField').style.display = scope === 'global' ? 'none' : 'block';
      document.getElementById('fsb_gradesMultiBox').style.display = scope === 'stage' ? 'block' : 'none';
      document.getElementById('fsb_gradeSingleField').style.display = scope === 'grade' ? 'block' : 'none';
    });
  });

  document.getElementById('fsb_saveBtn').addEventListener('click', async () => {
    const feeItemId = document.getElementById('fsb_feeItem').value;
    const amount = document.getElementById('fsb_amount').value.trim();
    const academicYear = document.getElementById('fs_sharedYear').value.trim();
    const wholeYear = document.getElementById('fsb_wholeYear').checked;
    const scope = document.querySelector('input[name="fsb_scope"]:checked').value;

    if (!feeItemId || amount === '' || !academicYear) { showToast('أكمل بند الرسم والمبلغ والعام الدراسي', 'error'); return; }

    let termIds;
    if (wholeYear) {
      termIds = terms.filter((t) => t.academic_year === academicYear).map((t) => t.id);
      if (!termIds.length) { showToast('لا توجد فصول مُعرَّفة لهذا العام الدراسي بالتحديد — تحقّق من صيغة العام', 'error'); return; }
    } else {
      const termId = document.getElementById('fs_sharedTerm').value;
      if (!termId) { showToast('اختر الفصل الدراسي', 'error'); return; }
      termIds = [termId];
    }

    let branchList;
    if (scope === 'global') {
      branchList = branches;
    } else {
      const branch = document.getElementById('fsb_branch').value;
      if (!branch) { showToast('اختر الفرع', 'error'); return; }
      branchList = [branch];
    }

    let gradeList;
    if (scope === 'global' || scope === 'branch') {
      gradeList = grades;
    } else if (scope === 'stage') {
      gradeList = collectCheckedValues('.fsb-grade-cb');
      if (!gradeList.length) { showToast('اختر صفاً واحداً على الأقل', 'error'); return; }
    } else {
      const grade = document.getElementById('fsb_gradeSingle').value;
      if (!grade) { showToast('اختر الصف', 'error'); return; }
      gradeList = [grade];
    }

    const totalCombos = termIds.length * branchList.length * gradeList.length;
    if (totalCombos > 40) {
      if (!(await showConfirmModal(`سيُطبَّق هذا الرسم على ${totalCombos} مجموعة (فرع × صف × فصل) — قد يستغرق هذا بضع ثوانٍ. متابعة؟`, 'تطبيق', 'إلغاء'))) return;
    }

    const btn = document.getElementById('fsb_saveBtn');
    btn.disabled = true;
    let savedCount = 0;
    try {
      for (const termId of termIds) {
        for (const branch of branchList) {
          for (const grade of gradeList) {
            await apiCall('fee-settings', {
              method: 'POST',
              body: { action: 'setFeeStructure', academicYear, termId, branch, grade, feeItemId, amount: Number(amount) },
            });
            savedCount++;
            btn.textContent = `جارِ الحفظ... (${savedCount}/${totalCombos})`;
          }
        }
      }
      showToast(`تم الحفظ بنجاح — طُبِّق على ${savedCount} مجموعة`, 'success');
    } catch (e) {
      showToast(e.message + ` (تم حفظ ${savedCount} من ${totalCombos} قبل التوقف)`, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'حفظ الرسم';
    }
  });

  /* ---------- شبكة المراجعة والتعديل الفردي ---------- */
  document.getElementById('fs_loadBtn').addEventListener('click', async () => {
    feeStructureFilters_.academicYear = document.getElementById('fs_sharedYear').value.trim();
    feeStructureFilters_.termId = document.getElementById('fs_sharedTerm').value;
    feeStructureFilters_.branch = document.getElementById('fs_branch').value;
    if (!feeStructureFilters_.academicYear || !feeStructureFilters_.termId || !feeStructureFilters_.branch) {
      showToast('أكمل العام والفصل والفرع أولاً', 'error');
      return;
    }
    await loadFeeStructureGrid_(grades, activeFeeItems);
  });

  if (feeStructureFilters_.academicYear && feeStructureFilters_.termId && feeStructureFilters_.branch) {
    await loadFeeStructureGrid_(grades, activeFeeItems);
  }
}

async function loadFeeStructureGrid_(grades, activeFeeItems) {
  const area = document.getElementById('fs_gradesArea');
  area.innerHTML = `<div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div>`;

  let existing;
  try {
    existing = await apiCall('fee-settings', {
      method: 'POST',
      body: { action: 'listFeeStructure', academicYear: feeStructureFilters_.academicYear, termId: feeStructureFilters_.termId, branch: feeStructureFilters_.branch },
    });
  } catch (e) {
    area.innerHTML = `<p style="color:#C4483A">${escapeHtml(e.message)}</p>`;
    return;
  }

  area.innerHTML = grades.map((grade) => {
    const rows = activeFeeItems.map((item) => {
      const existingRow = existing.find((r) => r.grade === grade && r.feeItemId === item.id);
      return `
        <div class="person-card-row" style="padding:8px 0">
          <span>${escapeHtml(item.name)}</span>
          <input type="number" min="0" step="0.01" class="fs-amount-input" data-grade="${escapeHtml(grade)}" data-fee-item="${item.id}"
            value="${existingRow ? existingRow.amount : ''}" placeholder="0.00"
            style="width:130px;padding:7px 10px;border:1.5px solid var(--outline);border-radius:8px;font-family:inherit">
        </div>`;
    }).join('');
    return `
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-top:0">${escapeHtml(grade)}</h3>
        ${rows}
        <button type="button" class="btn-outline-sm fs-save-grade-btn" data-grade="${escapeHtml(grade)}" style="margin-top:10px">حفظ رسوم ${escapeHtml(grade)}</button>
      </div>`;
  }).join('');

  area.querySelectorAll('.fs-save-grade-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const grade = btn.getAttribute('data-grade');
      btn.disabled = true; btn.textContent = 'جارِ الحفظ...';
      const inputs = area.querySelectorAll(`.fs-amount-input[data-grade="${CSS.escape(grade)}"]`);
      let savedCount = 0;
      try {
        for (const input of inputs) {
          const val = input.value.trim();
          if (val === '') continue;
          await apiCall('fee-settings', {
            method: 'POST',
            body: {
              action: 'setFeeStructure', academicYear: feeStructureFilters_.academicYear, termId: feeStructureFilters_.termId,
              branch: feeStructureFilters_.branch, grade, feeItemId: input.getAttribute('data-fee-item'), amount: Number(val),
            },
          });
          savedCount++;
        }
        showToast(savedCount ? 'تم الحفظ بنجاح' : 'لم يتغيَّر أي مبلغ', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = `حفظ رسوم ${grade}`;
      }
    });
  });
}

/* ===================== صفحة سجل التدقيق ===================== */

async function renderAuditLogView() {
  const main = document.getElementById('mainContent');
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  main.innerHTML = `
    <div class="card">
      <h2>سجل التدقيق</h2>
      <p style="color:#888;font-size:12.5px;margin-top:-10px">افتراضياً يعرض آخر 7 أيام فقط — وسِّع الفترة لو تحتاج مدى أطول</p>
      <div class="field"><label>من تاريخ</label><input type="date" id="audit_dateFrom" value="${weekAgo}"></div>
      <div class="field"><label>إلى تاريخ</label><input type="date" id="audit_dateTo" value="${today}"></div>
      <button type="button" id="audit_loadBtn">تحميل</button>
      <div class="field" style="margin-top:16px"><label>بحث بالاسم أو نوع العملية</label><input id="auditSearchInput" type="text"></div>
      <div id="auditLogListArea"><div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div></div>
    </div>`;

  document.getElementById('audit_loadBtn').addEventListener('click', loadAuditLogList);
  document.getElementById('auditSearchInput').addEventListener('input', renderAuditLogTable);
  loadAuditLogList();
}

async function loadAuditLogList() {
  const area = document.getElementById('auditLogListArea');
  area.innerHTML = `<div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div>`;
  const dateFrom = document.getElementById('audit_dateFrom').value;
  const dateToRaw = document.getElementById('audit_dateTo').value;
  const dateTo = dateToRaw ? `${dateToRaw}T23:59:59` : undefined;
  try {
    APP.allAuditLog = await apiCall('finance-staff', { method: 'POST', body: { action: 'auditLog', dateFrom, dateTo } });
    renderAuditLogTable();
  } catch (e) {
    area.innerHTML = `<p style="color:#C4483A">${escapeHtml(e.message)}</p>`;
  }
}

function renderAuditLogTable() {
  const area = document.getElementById('auditLogListArea');
  const q = (document.getElementById('auditSearchInput').value || '').trim().toLowerCase();
  const list = (APP.allAuditLog || []).filter((r) => !q || (r.emp_name || '').toLowerCase().includes(q) || (r.action || '').toLowerCase().includes(q));

  if (!list.length) { area.innerHTML = '<p style="color:#888">لا توجد عمليات مطابقة</p>'; return; }

  area.innerHTML = list.map((r) => `
    <div class="person-card-row" style="padding:10px 0;border-bottom:1px solid var(--surface);align-items:flex-start">
      <div>
        <div style="font-weight:700;font-size:13px">${escapeHtml(r.action)}</div>
        <div style="font-size:11.5px;color:var(--text-muted)">${escapeHtml(r.emp_name || '—')} — ${escapeHtml(ROLE_LABELS_AR[r.role] || r.role || '—')} — ${escapeHtml(r.branch || '—')}</div>
      </div>
      <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${new Date(r.created_at).toLocaleString('ar')}</span>
    </div>`).join('');
}

/* ===================== صفحة الطلاب ===================== */

const FINANCIAL_STATUS_LABELS_ = {
  CLEARED: { label: 'مسدَّد بالكامل', badge: 'status-badge-cleared' },
  PARTIALLY_PAID: { label: 'مسدَّد جزئياً', badge: 'status-badge-partial' },
  OVERDUE: { label: 'متأخر', badge: 'status-badge-overdue' },
  UNPAID: { label: 'غير مسدَّد', badge: 'status-badge-unpaid' },
  EXEMPT: { label: 'معفى', badge: 'status-badge-exempt' },
  BLOCKED: { label: 'موقوف مالياً', badge: 'status-badge-blocked' },
  NO_INVOICES: { label: 'بلا فواتير', badge: 'status-badge-off' },
};

let studentsCache_ = [];

async function renderStudentsView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="card"><div class="skel-rows"><div class="skel-row"></div></div></div>`;

  const isFullAccess = APP.user.role === 'role_admin' || APP.user.role === 'role_finance_admin';
  const [branches, grades, sections] = await Promise.all([getBranchesOnce(), getGradesOnce(), getSectionsOnce()]);

  main.innerHTML = `
    <div class="card">
      <div class="field"><label>بحث بالاسم أو رقم الطالب أو رقم الهوية أو اسم ولي الأمر</label><input type="text" id="stu_search" placeholder="ابحث هنا..."></div>
      <div class="kpi-grid" style="margin-bottom:0">
        ${isFullAccess ? `<div class="field"><label>الفرع</label><select id="stu_branch"><option value="">كل الفروع المتاحة</option>${branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label>الصف</label><select id="stu_grade"><option value="">كل الصفوف</option>${grades.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}</select></div>
        <div class="field"><label>الشعبة</label><select id="stu_section"><option value="">كل الشعب</option>${sections.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select></div>
        <div class="field"><label>الحالة المالية</label><select id="stu_status"><option value="">الكل</option>${Object.entries(FINANCIAL_STATUS_LABELS_).map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}</select></div>
      </div>
    </div>
    <div id="studentsListArea"><div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div></div>`;

  const triggerReload = debounce(loadStudentsList, 350);
  document.getElementById('stu_search').addEventListener('input', triggerReload);
  const branchEl = document.getElementById('stu_branch');
  if (branchEl) branchEl.addEventListener('change', loadStudentsList);
  document.getElementById('stu_grade').addEventListener('change', loadStudentsList);
  document.getElementById('stu_section').addEventListener('change', loadStudentsList);
  document.getElementById('stu_status').addEventListener('change', renderStudentsGrid); // فلتر محلي فقط — بلا إعادة جلب من الخادم

  await loadStudentsList();
}

async function loadStudentsList() {
  const area = document.getElementById('studentsListArea');
  area.innerHTML = `<div class="skel-rows"><div class="skel-row"></div><div class="skel-row"></div></div>`;

  const body = {
    search: document.getElementById('stu_search').value.trim(),
    grade: document.getElementById('stu_grade').value,
    section: document.getElementById('stu_section').value,
  };
  const branchEl = document.getElementById('stu_branch');
  if (branchEl) body.branch = branchEl.value;

  try {
    studentsCache_ = await apiCall('students-finance', { method: 'POST', body: { action: 'list', ...body } });
    renderStudentsGrid();
  } catch (e) {
    area.innerHTML = `<p style="color:#C4483A">${escapeHtml(e.message)}</p>`;
  }
}

function renderStudentsGrid() {
  const area = document.getElementById('studentsListArea');
  const statusFilter = document.getElementById('stu_status').value;
  const list = statusFilter ? studentsCache_.filter((s) => s.financialStatus === statusFilter) : studentsCache_;

  if (!list.length) { area.innerHTML = '<p style="color:#888">لا يوجد طلاب مطابقون</p>'; return; }

  area.innerHTML = `<div class="person-card-grid">${list.map((s) => {
    const info = FINANCIAL_STATUS_LABELS_[s.financialStatus] || FINANCIAL_STATUS_LABELS_.NO_INVOICES;
    return `
    <div class="person-card" data-id="${escapeHtml(s.id)}" data-card-clickable>
      <div class="person-card-header">
        <span class="person-avatar">${escapeHtml((s.nameAr || '؟').trim().charAt(0))}</span>
        <div class="person-card-info">
          <div class="person-card-name">${escapeHtml(s.nameAr)}</div>
          <div class="person-card-role">${escapeHtml(s.grade)} — ${escapeHtml(s.section)}</div>
        </div>
        <span class="status-badge ${info.badge}">${escapeHtml(info.label)}</span>
      </div>
      <div class="person-card-body">
        <div class="person-card-row"><span>رقم الطالب</span><span>${escapeHtml(s.id)}</span></div>
        <div class="person-card-row"><span>الفرع</span><span>${escapeHtml(s.branch)}</span></div>
      </div>
    </div>`;
  }).join('')}</div>`;

  area.querySelectorAll('[data-card-clickable]').forEach((card) => {
    card.addEventListener('click', () => openStudentFinanceCard(card.getAttribute('data-id')));
  });
}

/** بطاقة الطالب المالية الموسَّعة — بياناته، فواتيره، وزرّا تسجيل دفعة وكشف حساب */
async function openStudentFinanceCard(studentId) {
  let data;
  try {
    data = await apiCall('students-finance', { method: 'POST', body: { action: 'getCard', studentId } });
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }

  const student = data.student;
  const latestClearance = data.clearance[0];
  const statusInfo = FINANCIAL_STATUS_LABELS_[latestClearance?.status] || FINANCIAL_STATUS_LABELS_.NO_INVOICES;

  const INVOICE_STATUS_LABELS_ = { unpaid: 'غير مسدَّدة', partially_paid: 'مسدَّدة جزئياً', paid: 'مسدَّدة بالكامل', void: 'مُلغاة' };
  const invoicesHtml = data.invoices.length ? data.invoices.map((inv) => {
    const remaining = Number(inv.total_amount) - Number(inv.paid_amount);
    return `
      <div class="invoice-row">
        <div class="invoice-row-main">
          <div class="invoice-row-title">${escapeHtml(inv.invoice_number)}</div>
          <div class="invoice-row-sub">${new Date(inv.issue_date).toLocaleDateString('ar-SA')} — ${escapeHtml(INVOICE_STATUS_LABELS_[inv.status] || inv.status)}</div>
        </div>
        <div class="invoice-row-amounts">
          <div>${formatMoney(inv.total_amount)}</div>
          ${remaining > 0 && inv.status !== 'void' ? `<div class="invoice-row-remaining">متبقي: ${formatMoney(remaining)}</div>` : ''}
        </div>
      </div>`;
  }).join('') : '<p style="color:#888;font-size:12.5px">لا توجد فواتير بعد</p>';

  const { overlay } = showDetailModal(student.name_ar, `${student.grade} — ${student.section} — ${student.branch}`, [
    { label: 'رقم الطالب', value: student.id },
    { label: 'رقم الهوية', value: student.national_id },
    { label: 'الحالة المالية', value: statusInfo.label },
    { label: 'إجمالي المستحق', value: formatMoney(data.totalOutstanding) },
  ], `
    <div style="margin:14px 0"><h4 style="margin:0 0 8px;font-size:13px;color:var(--primary)">الفواتير</h4>${invoicesHtml}</div>
    <div class="receipt-actions">
      <button type="button" id="openRecordPaymentBtn">${ICONS.payment()} تسجيل دفعة جديدة</button>
      <button type="button" id="openStatementBtn" class="btn-outline-sm">${ICONS.invoice()} كشف الحساب</button>
    </div>
  `);

  const openInvoices = data.invoices.filter((i) => i.status === 'unpaid' || i.status === 'partially_paid');
  document.getElementById('openRecordPaymentBtn').addEventListener('click', () => {
    overlay.remove();
    openRecordPaymentModal(student, openInvoices);
  });
  document.getElementById('openStatementBtn').addEventListener('click', () => {
    overlay.remove();
    openStatementView(student);
  });
}

/** نموذج تسجيل دفعة جديدة — يُفتَح من بطاقة الطالب المالية (من صفحة الطلاب أو لاحقاً من الفواتير) */
async function openRecordPaymentModal(student, openInvoices) {
  if (!openInvoices.length) {
    showToast('لا توجد فواتير مستحقة لهذا الطالب حالياً', 'error');
    return;
  }

  const invoiceOptions = openInvoices.map((inv) => {
    const remaining = Number(inv.total_amount) - Number(inv.paid_amount);
    return `<option value="${inv.id}" data-remaining="${remaining}">${escapeHtml(inv.invoice_number)} — متبقي ${formatMoney(remaining)}</option>`;
  }).join('');

  const { close } = showFormModal('تسجيل دفعة جديدة', student.name_ar, `
    <form id="paymentForm">
      <div class="field"><label>الفاتورة *</label><select id="pay_invoice" required>${invoiceOptions}</select></div>
      <div class="field"><label>المبلغ (ريال) *</label><input type="number" min="0.01" step="0.01" id="pay_amount" required></div>
      <div class="field"><label>طريقة الدفع *</label><select id="pay_method" required><option value="">-- جارِ التحميل --</option></select></div>
      <div class="field"><label>رقم المرجع</label><input type="text" id="pay_ref"></div>
      <div class="field"><label>تاريخ الدفع</label><input type="date" id="pay_date" value="${todayISODate()}"></div>
      <div class="field"><label>ملاحظات</label><input type="text" id="pay_notes"></div>
      <button type="submit" id="pay_submitBtn" style="width:100%">حفظ الدفعة</button>
    </form>
  `);

  apiCall('fee-settings', { method: 'POST', body: { action: 'listPaymentMethods' } }).then((methods) => {
    document.getElementById('pay_method').innerHTML = methods.filter((m) => m.is_active).map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  }).catch(() => { document.getElementById('pay_method').innerHTML = '<option value="">تعذّر تحميل طرق الدفع</option>'; });

  const invoiceSelect = document.getElementById('pay_invoice');
  const amountInput = document.getElementById('pay_amount');
  const fillAmount = () => { const opt = invoiceSelect.selectedOptions[0]; if (opt) amountInput.value = opt.getAttribute('data-remaining'); };
  invoiceSelect.addEventListener('change', fillAmount);
  fillAmount();

  document.getElementById('paymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('pay_submitBtn');
    btn.disabled = true; btn.textContent = 'جارِ الحفظ...';
    try {
      const result = await apiCall('payments', {
        method: 'POST',
        body: {
          action: 'record', invoiceId: invoiceSelect.value, amount: Number(amountInput.value),
          paymentMethodId: document.getElementById('pay_method').value,
          referenceNumber: document.getElementById('pay_ref').value.trim(),
          paymentDate: document.getElementById('pay_date').value,
          notes: document.getElementById('pay_notes').value.trim(),
        },
      });
      showToast('تم الحفظ بنجاح' + (result.isOverpayment ? ' (دفعة زائدة عن المتبقي)' : ''), 'success');
      close();
      await openReceiptModal(result.id);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'حفظ الدفعة';
    }
  });
}

/** توليد HTML سند القبض — مستند واحد ذاتي الاكتفاء (أنماط داخلية)، يُستخدَم بالمعاينة والطباعة والـPDF معاً */
function generateReceiptHtml(payment, invoice, student, recorderName, paymentMethodName, siteInfo) {
  return `
    <div style="font-family:'Manrope',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;padding:26px;background:#fff;color:#202124;max-width:480px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;justify-content:center;margin-bottom:6px">
        ${siteInfo.logoUrl ? `<img src="${siteInfo.logoUrl}" crossorigin="anonymous" style="width:52px;height:52px;border-radius:10px;object-fit:cover">` : ''}
        <div style="text-align:center">
          <div style="font-weight:800;font-size:16px">${escapeHtml(siteInfo.schoolName || 'المدرسة')}</div>
          <div style="font-size:11.5px;color:#78787a">${escapeHtml(payment.branch)}</div>
        </div>
      </div>
      <div style="text-align:center;font-weight:800;font-size:18px;margin:14px 0 4px;border-top:2px solid #202124;border-bottom:2px solid #202124;padding:8px 0">سند قبض</div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:#78787a;margin-bottom:14px">
        <span>رقم السند: ${escapeHtml(payment.payment_number)}</span>
        <span>التاريخ: ${new Date(payment.payment_date).toLocaleDateString('ar-SA')}</span>
      </div>
      <div style="background:#F5F5F4;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:#78787a">اسم الطالب</span><span style="font-weight:700">${escapeHtml(student.name_ar)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:#78787a">رقم الهوية</span><span style="font-weight:700">${escapeHtml(student.national_id || '—')}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:#78787a">الصف</span><span style="font-weight:700">${escapeHtml(student.grade)} — ${escapeHtml(student.section)}</span></div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px">
        <tr style="border-bottom:1px solid #E7E7E5"><td style="padding:8px 0;color:#78787a">رقم الفاتورة</td><td style="padding:8px 0;font-weight:700;text-align:left">${escapeHtml(invoice?.invoice_number || '—')}</td></tr>
        <tr style="border-bottom:1px solid #E7E7E5"><td style="padding:8px 0;color:#78787a">طريقة الدفع</td><td style="padding:8px 0;font-weight:700;text-align:left">${escapeHtml(paymentMethodName || '—')}</td></tr>
        ${payment.reference_number ? `<tr style="border-bottom:1px solid #E7E7E5"><td style="padding:8px 0;color:#78787a">رقم المرجع</td><td style="padding:8px 0;font-weight:700;text-align:left">${escapeHtml(payment.reference_number)}</td></tr>` : ''}
        <tr><td style="padding:12px 0 4px;color:#78787a;font-size:15px">المبلغ المستلم</td><td style="padding:12px 0 4px;font-weight:800;text-align:left;font-size:19px">${formatMoney(payment.amount)}</td></tr>
      </table>
      ${payment.notes ? `<div style="font-size:12px;color:#78787a;margin-bottom:14px">ملاحظات: ${escapeHtml(payment.notes)}</div>` : ''}
      <div style="border-top:1px dashed #E7E7E5;padding-top:10px;font-size:11px;color:#78787a;display:flex;justify-content:space-between">
        <span>استلمها: ${escapeHtml(recorderName || '—')}</span>
        <span>شكراً لتعاملكم معنا</span>
      </div>
    </div>`;
}

/** نافذة سند القبض — تُفتَح تلقائياً بعد تسجيل أي دفعة، وقابلة لإعادة الفتح لاحقاً بمعرِّف الدفعة فقط */
async function openReceiptModal(paymentId) {
  let data;
  try {
    data = await apiCall('payments', { method: 'POST', body: { action: 'get', paymentId } });
    if (!APP.siteInfo) {
      APP.siteInfo = await apiCall('fee-settings', { method: 'POST', body: { action: 'getSiteInfo' }, requiresAuth: false });
    }
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }

  const receiptHtml = generateReceiptHtml(data.payment, data.invoice, data.student, data.recorderName, data.paymentMethodName, APP.siteInfo);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card modal-card-lg">
      <div class="modal-header">
        <div><h3>سند القبض</h3><p class="modal-subtitle">تم الحفظ بنجاح</p></div>
        <button type="button" class="modal-close-btn" id="receiptCloseBtn">${ICONS.close()}</button>
      </div>
      <div class="modal-body">
        <div class="receipt-preview-wrap" id="receiptPreviewArea">${receiptHtml}</div>
        <div class="receipt-actions">
          <button type="button" id="receiptPrintBtn">${ICONS.print()} طباعة</button>
          <button type="button" id="receiptDownloadBtn" class="btn-outline-sm">${ICONS.download()} تحميل PDF</button>
          <button type="button" id="receiptShareBtn" class="btn-outline-sm">${ICONS.share()} مشاركة</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('receiptCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('receiptPrintBtn').addEventListener('click', () => printHtmlDocument(receiptHtml, 'سند قبض - ' + data.payment.payment_number));
  document.getElementById('receiptDownloadBtn').addEventListener('click', () => downloadHtmlAsPdf(document.getElementById('receiptPreviewArea'), `سند_قبض_${data.payment.payment_number}`));
  document.getElementById('receiptShareBtn').addEventListener('click', () => shareHtmlAsPdf(document.getElementById('receiptPreviewArea'), `سند_قبض_${data.payment.payment_number}`, 'سند قبض'));
}

/** نافذة كشف الحساب — بنفس هوية سند القبض البصرية بالضبط، قابلة للطباعة/التحميل/المشاركة */
async function openStatementView(student) {
  const studentName = student.nameAr || student.name_ar;
  let data;
  try {
    data = await apiCall('students-finance', { method: 'POST', body: { action: 'getStatement', studentId: student.id } });
    if (!APP.siteInfo) {
      APP.siteInfo = await apiCall('fee-settings', { method: 'POST', body: { action: 'getSiteInfo' }, requiresAuth: false });
    }
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }

  const rowsHtml = data.ledger.map((r) => `
    <tr style="border-bottom:1px solid #E7E7E5">
      <td style="padding:8px 4px;font-size:11.5px">${new Date(r.entry_date).toLocaleDateString('ar-SA')}</td>
      <td style="padding:8px 4px;font-size:11.5px">${escapeHtml(r.ref_number)}</td>
      <td style="padding:8px 4px;font-size:11.5px;text-align:left">${Number(r.debit) ? formatMoney(r.debit) : '—'}</td>
      <td style="padding:8px 4px;font-size:11.5px;text-align:left">${Number(r.credit) ? formatMoney(r.credit) : '—'}</td>
      <td style="padding:8px 4px;font-size:11.5px;text-align:left;font-weight:700">${formatMoney(r.runningBalance)}</td>
    </tr>`).join('');

  const statementHtml = `
    <div style="font-family:'Manrope',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;padding:26px;background:#fff;color:#202124">
      <div style="display:flex;align-items:center;gap:12px;justify-content:center;margin-bottom:6px">
        ${APP.siteInfo.logoUrl ? `<img src="${APP.siteInfo.logoUrl}" crossorigin="anonymous" style="width:52px;height:52px;border-radius:10px;object-fit:cover">` : ''}
        <div style="text-align:center">
          <div style="font-weight:800;font-size:16px">${escapeHtml(APP.siteInfo.schoolName || 'المدرسة')}</div>
          <div style="font-size:11.5px;color:#78787a">${escapeHtml(student.branch)}</div>
        </div>
      </div>
      <div style="text-align:center;font-weight:800;font-size:18px;margin:14px 0 4px;border-top:2px solid #202124;border-bottom:2px solid #202124;padding:8px 0">كشف حساب</div>
      <div style="background:#F5F5F4;border-radius:12px;padding:14px;margin:14px 0">
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:#78787a">اسم الطالب</span><span style="font-weight:700">${escapeHtml(studentName)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:#78787a">الصف</span><span style="font-weight:700">${escapeHtml(student.grade)} — ${escapeHtml(student.section)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px"><span style="color:#78787a">تاريخ الإصدار</span><span style="font-weight:700">${new Date().toLocaleDateString('ar-SA')}</span></div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:2px solid #202124;font-size:11px;color:#78787a">
          <th style="padding:6px 4px;text-align:right">التاريخ</th><th style="padding:6px 4px;text-align:right">المرجع</th>
          <th style="padding:6px 4px;text-align:left">مدين</th><th style="padding:6px 4px;text-align:left">دائن</th><th style="padding:6px 4px;text-align:left">الرصيد</th>
        </tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="5" style="padding:20px;text-align:center;color:#888">لا توجد حركات بعد</td></tr>'}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:2px solid #202124;font-weight:800;font-size:15px">
        <span>الرصيد الحالي (المستحق)</span><span>${formatMoney(data.currentBalance)}</span>
      </div>
    </div>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card modal-card-lg">
      <div class="modal-header">
        <div><h3>كشف الحساب</h3><p class="modal-subtitle">${escapeHtml(studentName)}</p></div>
        <button type="button" class="modal-close-btn" id="stmtCloseBtn">${ICONS.close()}</button>
      </div>
      <div class="modal-body">
        <div class="receipt-preview-wrap" id="stmtPreviewArea">${statementHtml}</div>
        <div class="receipt-actions">
          <button type="button" id="stmtPrintBtn">${ICONS.print()} طباعة</button>
          <button type="button" id="stmtDownloadBtn" class="btn-outline-sm">${ICONS.download()} تحميل PDF</button>
          <button type="button" id="stmtShareBtn" class="btn-outline-sm">${ICONS.share()} مشاركة</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  document.getElementById('stmtCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('stmtPrintBtn').addEventListener('click', () => printHtmlDocument(statementHtml, 'كشف حساب - ' + studentName));
  document.getElementById('stmtDownloadBtn').addEventListener('click', () => downloadHtmlAsPdf(document.getElementById('stmtPreviewArea'), `كشف_حساب_${student.id}`));
  document.getElementById('stmtShareBtn').addEventListener('click', () => shareHtmlAsPdf(document.getElementById('stmtPreviewArea'), `كشف_حساب_${student.id}`, 'كشف حساب'));
}
