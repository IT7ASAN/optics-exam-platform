/**
 * Optics Common Exam Platform - Main Application Controller
 * منصة الامتحان المشترك – قسم تقنيات البصريات
 * تدعم التمرير السلس، الثيم البنفسجي، وتسجيل دخول المشرف (it7asan) وحسابات الطلاب،
 * والتحكم الكامل في نصوص الهيرو وصفحة حول المنصة وبطاقة القسم، ورفع الملفات من الجهاز.
 */

const App = (() => {
  const state = {
    currentView: 'home',
    currentStageId: null,
    currentSubjectId: null,
    currentFileId: null,
    theme: 'light',
    data: null,
    currentUser: null,
    isAdmin: false
  };

  /**
   * نقطة الدخول الرئيسية
   */
  async function init() {
    state.currentUser = window.DataLayer.getCurrentUser();
    state.isAdmin = window.DataLayer.isAdminLoggedIn();

    setupTheme();
    setupEventListeners();
    setupSmoothScrolling();
    setupRouting();
    if (await setupInstallPrompt()) return;

    // تهيئة عارض PDF
    PDFViewer.init({
      container: document.getElementById('pdf-viewer-overlay'),
      canvas: document.getElementById('pdf-canvas'),
      pageNumSpan: document.getElementById('pdf-page-num'),
      pageCountSpan: document.getElementById('pdf-page-count'),
      loadingEl: document.getElementById('pdf-loading-spinner'),
      errorEl: document.getElementById('pdf-error-state'),
      titleEl: document.getElementById('pdf-header-title'),
      subtitleEl: document.getElementById('pdf-header-subtitle')
    });

    // جلب البيانات وبناء الواجهة
    try {
      showGlobalLoading(true);
      state.data = await window.DataLayer.loadData();
      showGlobalLoading(false);

      updateGlobalBranding(state.data);
      updateAdminUI();
      handleHashChange();
    } catch (err) {
      console.error('Initialization error:', err);
      showGlobalLoading(false);
      showDataLoadError(err.message);
    }

    updateInstallButton();
    refreshIcons();
    setupAutoRefresh();
  }

  /**
   * التمرير السلس (Smooth Scrolling)
   */
  function setupSmoothScrolling() {
    document.documentElement.style.scrollBehavior = 'smooth';

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href === '#stages') {
          e.preventDefault();
          if (state.currentView !== 'home') {
            navigateToHash('#home');
            setTimeout(() => scrollToSection('stages-section'), 100);
          } else {
            scrollToSection('stages-section');
          }
        } else if (href === '#home') {
          if (state.currentView === 'home') {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      });
    });
  }

  function scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * إدارة الثيم (الوضع الليلي والنهاري)
   */
  function setupTheme() {
    const savedTheme = localStorage.getItem('optics_app_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    state.theme = savedTheme ? savedTheme : (prefersDark ? 'dark' : 'light');
    applyTheme(state.theme);

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('optics_app_theme')) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }

    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
        showToast(nextTheme === 'dark' ? 'تم تفعيل الوضع الليلي 🌙' : 'تم تفعيل الوضع النهاري ☀️');
      });
    }
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('optics_app_theme', theme);

    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
      refreshIcons();
    }
  }

  /**
   * ربط الأحداث العامة
   */
  function setupEventListeners() {
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openSearchModal();
      } else if (e.key === 'Escape') {
        closeSearchModal();
        closeLoginModal();
        closeEditModal();
      }
    });

    const headerSearchBtn = document.getElementById('header-search-btn');
    if (headerSearchBtn) headerSearchBtn.addEventListener('click', openSearchModal);

    const heroSearchInput = document.getElementById('hero-search-input');
    if (heroSearchInput) {
      heroSearchInput.addEventListener('focus', () => openSearchModal(heroSearchInput.value));
      heroSearchInput.addEventListener('input', (e) => openSearchModal(e.target.value));
    }

    const closeSearchBtn = document.getElementById('close-search-btn');
    const searchBackdrop = document.getElementById('search-modal-backdrop');
    if (closeSearchBtn) closeSearchBtn.addEventListener('click', closeSearchModal);
    if (searchBackdrop) {
      searchBackdrop.addEventListener('click', e => {
        if (e.target === searchBackdrop) closeSearchModal();
      });
    }

    const modalSearchInput = document.getElementById('modal-search-input');
    if (modalSearchInput) {
      modalSearchInput.addEventListener('input', e => handleSearchInput(e.target.value));
    }

    const clearSearchBtn = document.getElementById('clear-search-btn');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        if (modalSearchInput) {
          modalSearchInput.value = '';
          modalSearchInput.focus();
        }
        handleSearchInput('');
      });
    }

    // زر الحساب / تسجيل الدخول
    const authTriggerBtn = document.getElementById('auth-trigger-btn');
    if (authTriggerBtn) {
      authTriggerBtn.addEventListener('click', () => {
        if (state.isAdmin) {
          navigateToHash('#admin');
        } else if (state.currentUser) {
          handleLogout();
        } else {
          openLoginModal();
        }
      });
    }

    // نماذج المصادقة
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);

    const closeLoginBtn = document.getElementById('close-login-btn');
    const loginBackdrop = document.getElementById('login-modal-backdrop');
    if (closeLoginBtn) closeLoginBtn.addEventListener('click', closeLoginModal);
    if (loginBackdrop) {
      loginBackdrop.addEventListener('click', e => {
        if (e.target === loginBackdrop) closeLoginModal();
      });
    }

    // أزرار لوحة الإدارة
    const adminLogoutBtn = document.getElementById('admin-logout-btn');
    if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', handleLogout);

    const homeContentForm = document.getElementById('home-content-form');
    if (homeContentForm) homeContentForm.addEventListener('submit', handleHomeContentSubmit);

    const aboutContentForm = document.getElementById('about-content-form');
    if (aboutContentForm) aboutContentForm.addEventListener('submit', handleAboutContentSubmit);

    const githubSyncForm = document.getElementById('github-sync-form');
    if (githubSyncForm) githubSyncForm.addEventListener('submit', handleGitHubSyncSubmit);

    const cloudSyncForm = document.getElementById('cloud-sync-form');
    if (cloudSyncForm) cloudSyncForm.addEventListener('submit', handleCloudSyncSubmit);

    const quickPublishGhBtn = document.getElementById('quick-publish-gh-btn');
    if (quickPublishGhBtn) quickPublishGhBtn.addEventListener('click', handleQuickPublish);

    const ghTestConnBtn = document.getElementById('gh-test-conn-btn');
    if (ghTestConnBtn) ghTestConnBtn.addEventListener('click', handleTestGitHubConnection);

    const exportJsonBtn = document.getElementById('export-json-btn');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        window.DataLayer.exportDataAsJSON();
        showToast('تم تصدير وتحميل ملف exams.json بنجاح 📁');
      });
    }

    const resetDefaultsBtn = document.getElementById('reset-defaults-btn');
    if (resetDefaultsBtn) {
      resetDefaultsBtn.addEventListener('click', async () => {
        if (confirm('هل أنت متأكد من استعادة البيانات الافتراضية؟ سيتم مسح أي تعديلات محلية.')) {
          showGlobalLoading(true);
          state.data = await window.DataLayer.resetToDefault();
          showGlobalLoading(false);
          updateGlobalBranding(state.data);
          renderAdminPanel();
          showToast('تمت استعادة البيانات الافتراضية بنجاح 🔄');
          handleHashChange();
        }
      });
    }

    // تبويبات لوحة الإدارة
    document.querySelectorAll('[data-admin-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const targetTab = tabBtn.getAttribute('data-admin-tab');
        switchAdminTab(targetTab);
      });
    });

    // شريط التنقل السفلي للهاتف
    const navButtons = document.querySelectorAll('[data-nav-target]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-nav-target');
        if (target === 'search') {
          openSearchModal();
        } else if (target === 'admin') {
          if (state.isAdmin) {
            navigateToHash('#admin');
          } else if (state.currentUser) {
            handleLogout();
          } else {
            openLoginModal();
          }
        } else {
          navigateToHash(`#${target}`);
        }
      });
    });

    // أزرار قارئ PDF
    const pdfBackBtn = document.getElementById('pdf-btn-back');
    if (pdfBackBtn) {
      pdfBackBtn.addEventListener('click', () => {
        if (state.currentStageId && state.currentSubjectId) {
          navigateToHash(`#subject/${state.currentStageId}/${state.currentSubjectId}`);
        } else {
          navigateToHash('#home');
        }
      });
    }

    const prevPageBtn = document.getElementById('pdf-btn-prev');
    if (prevPageBtn) prevPageBtn.addEventListener('click', PDFViewer.prevPage);

    const nextPageBtn = document.getElementById('pdf-btn-next');
    if (nextPageBtn) nextPageBtn.addEventListener('click', PDFViewer.nextPage);

    const zoomInBtn = document.getElementById('pdf-btn-zoom-in');
    if (zoomInBtn) zoomInBtn.addEventListener('click', PDFViewer.zoomIn);

    const zoomOutBtn = document.getElementById('pdf-btn-zoom-out');
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', PDFViewer.zoomOut);

    const fitWidthBtn = document.getElementById('pdf-btn-fit');
    if (fitWidthBtn) fitWidthBtn.addEventListener('click', PDFViewer.fitToWidth);

    const fullScreenBtn = document.getElementById('pdf-btn-fullscreen');
    if (fullScreenBtn) fullScreenBtn.addEventListener('click', PDFViewer.toggleFullscreen);

    const downloadBtn = document.getElementById('pdf-btn-download');
    if (downloadBtn) downloadBtn.addEventListener('click', PDFViewer.downloadCurrentFile);

    const openTabBtn = document.getElementById('pdf-btn-opentab');
    if (openTabBtn) openTabBtn.addEventListener('click', PDFViewer.openInNewTab);
  }

  /**
   * التوجيه بالهاش ومراقبة الروابط
   */
  function setupRouting() {
    window.addEventListener('hashchange', handleHashChange);
  }

  function navigateToHash(hash) {
    window.location.hash = hash;
  }

  function handleHashChange() {
    const hash = window.location.hash.slice(1) || 'home';
    const parts = hash.split('/');
    const route = parts[0];

    updateActiveNavIndicators(route);

    if (route === 'home' || !route) {
      renderHomeView();
    } else if (route === 'stages') {
      renderHomeView();
      scrollToSection('stages-section');
    } else if (route === 'stage') {
      const stageId = parts[1];
      renderStageView(stageId);
    } else if (route === 'subject') {
      const stageId = parts[1];
      const subjectId = parts[2];
      renderSubjectView(stageId, subjectId);
    } else if (route === 'file') {
      const stageId = parts[1];
      const subjectId = parts[2];
      const fileId = parts[3];
      renderPdfReaderView(stageId, subjectId, fileId);
    } else if (route === 'about') {
      renderAboutView();
    } else if (route === 'admin') {
      if (state.isAdmin) {
        renderAdminPanel();
      } else {
        openLoginModal();
        navigateToHash('#home');
      }
    } else {
      renderNotFoundView();
    }

    if (route !== 'stages') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    refreshIcons();
  }

  function updateActiveNavIndicators(activeRoute) {
    document.querySelectorAll('[data-nav-target]').forEach(btn => {
      const target = btn.getAttribute('data-nav-target');
      if (target === activeRoute) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  /**
   * تحديث واجهة المستخدم حسب حالة الحساب (مشرف أو طالب أو زائر)
   */
  function updateAdminUI() {
    state.currentUser = window.DataLayer.getCurrentUser();
    state.isAdmin = window.DataLayer.isAdminLoggedIn();
    const authBtn = document.getElementById('auth-trigger-btn');
    const authMobileBtn = document.getElementById('auth-mobile-tab-btn');
    const adminNavLinks = document.querySelectorAll('.admin-only-nav');

    if (state.isAdmin) {
      if (authBtn) {
        authBtn.innerHTML = `
          <div class="admin-header-chip" title="لوحة تحكم المشرف">
            <i data-lucide="shield-check" style="width: 14px; height: 14px;"></i>
            <span>it7asan (مشرف)</span>
          </div>
        `;
      }
      if (authMobileBtn) {
        authMobileBtn.innerHTML = `
          <i data-lucide="shield-check" style="width: 20px; height: 20px;"></i>
          <span>الإدارة</span>
        `;
      }
      adminNavLinks.forEach(el => el.style.display = 'inline-flex');
    } else if (state.currentUser) {
      if (authBtn) {
        authBtn.innerHTML = `
          <div class="admin-header-chip" style="background: var(--bg-surface-elevated); color: var(--accent); border: 1px solid var(--border-medium);" title="حساب الطالب">
            <i data-lucide="user-check" style="width: 14px; height: 14px;"></i>
            <span>${state.currentUser.displayName || state.currentUser.username}</span>
          </div>
        `;
      }
      if (authMobileBtn) {
        authMobileBtn.innerHTML = `
          <i data-lucide="user-check" style="width: 20px; height: 20px;"></i>
          <span>حسابي</span>
        `;
      }
      updateInstallButton();
      adminNavLinks.forEach(el => el.style.display = 'none');
    } else {
      if (authBtn) {
        authBtn.innerHTML = `
          <div class="icon-btn" title="تسجيل الدخول / إنشاء حساب">
            <i data-lucide="user" style="width: 18px; height: 18px;"></i>
          </div>
        `;
      }
      if (authMobileBtn) {
        authMobileBtn.innerHTML = `
          <i data-lucide="user" style="width: 20px; height: 20px;"></i>
          <span>دخول</span>
        `;
      }
      updateInstallButton();
      adminNavLinks.forEach(el => el.style.display = 'none');
    }
    updateInstallButton();
    refreshIcons();
  }

  /**
   * التبديل بين تبويبات تسجيل الدخول وإنشاء الحساب
   */
  function switchAuthTab(tab) {
    const btnSignin = document.getElementById('tab-btn-signin');
    const btnSignup = document.getElementById('tab-btn-signup');
    const formLogin = document.getElementById('login-form');
    const formRegister = document.getElementById('register-form');
    const errorEl = document.getElementById('login-error-msg');
    const titleEl = document.getElementById('auth-modal-title');

    if (errorEl) errorEl.style.display = 'none';

    if (tab === 'signup') {
      if (btnSignin) btnSignin.classList.remove('active');
      if (btnSignup) btnSignup.classList.add('active');
      if (formLogin) formLogin.style.display = 'none';
      if (formRegister) formRegister.style.display = 'block';
      if (titleEl) titleEl.textContent = 'إنشاء حساب طالب جديد';
      const fInput = document.getElementById('reg-fullname');
      if (fInput) fInput.focus();
    } else {
      if (btnSignup) btnSignup.classList.remove('active');
      if (btnSignin) btnSignin.classList.add('active');
      if (formRegister) formRegister.style.display = 'none';
      if (formLogin) formLogin.style.display = 'block';
      if (titleEl) titleEl.textContent = 'تسجيل الدخول إلى المنصة';
      const uInput = document.getElementById('login-username');
      if (uInput) uInput.focus();
    }
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error-msg');

    const username = usernameInput ? usernameInput.value : '';
    const password = passwordInput ? passwordInput.value : '';

    const res = await window.DataLayer.login(username, password);
    if (res.success) {
      if (errorEl) errorEl.style.display = 'none';
      closeLoginModal();
      updateAdminUI();
      if (res.role === 'admin') {
        showToast('مرحباً بك يا مدير المنصة (it7asan) 👑');
        navigateToHash('#admin');
      } else {
        showToast(`مرحباً بك يا ${res.session.displayName} 🎓`);
      }
    } else {
      if (errorEl) {
        errorEl.textContent = res.message;
        errorEl.style.display = 'block';
      }
    }
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    const fullName = document.getElementById('reg-fullname').value;
    const usernameInput = document.getElementById('reg-username');
    const username = usernameInput.value.trim();
    const password = document.getElementById('reg-password').value;
    const stage = document.getElementById('reg-stage').value;
    const errorEl = document.getElementById('login-error-msg');

    if (!/^[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(username)) {
      if (errorEl) {
        errorEl.textContent = 'اسم المستخدم يجب أن يكون من 3 إلى 30 حرفاً، يبدأ بحرف إنجليزي، ويسمح بالأرقام والنقطة والشرطة والشرطة السفلية.';
        errorEl.style.display = 'block';
      }
      usernameInput.focus();
      return;
    }

    const res = await window.DataLayer.registerUser({ username, password, fullName, stage });
    if (res.success) {
      if (errorEl) errorEl.style.display = 'none';
      localStorage.setItem('optics_account_created', 'true');
      closeLoginModal();
      updateAdminUI();
      updateInstallButton();
      showToast(`تم إنشاء الحساب بنجاح! مرحباً بك يا ${res.user.fullName} 🎉`);
    } else {
      if (errorEl) {
        errorEl.textContent = res.message;
        errorEl.style.display = 'block';
      }
    }
  }

  function handleLogout() {
    const displayName = state.currentUser?.displayName || 'حسابك';
    if (!confirm(`هل تريد تسجيل الخروج من ${displayName}؟`)) return;
    window.DataLayer.logout();
    updateAdminUI();
    showToast('تم تسجيل الخروج بنجاح 👋');
    navigateToHash('#home');
  }

  let deferredInstallPrompt = null;

  function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function updateInstallButton() {
    const installPrompt = document.getElementById('install-app-prompt');
    const aboutInstallCard = document.querySelector('.about-install-card');
    const shouldHide = isAppInstalled() || !!window.DataLayer.getCurrentUser() || localStorage.getItem('optics_account_created') === 'true';
    if (installPrompt) installPrompt.hidden = shouldHide;
    if (aboutInstallCard) aboutInstallCard.hidden = shouldHide;
  }

  async function setupInstallPrompt() {
    const installButtons = document.querySelectorAll('#install-app-button, #about-install-app-button');
    if (!installButtons.length) return false;

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      updateInstallButton();
      showToast('تم تثبيت المنصة بنجاح على جهازك 📱');
    });
    const promptInstall = async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (choice?.outcome === 'accepted') updateInstallButton();
        return;
      }

      const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
      showToast(isIos
        ? 'لتثبيت المنصة على iPhone: اضغط «مشاركة» في Safari ثم «إضافة إلى الشاشة الرئيسية».'
        : 'من قائمة المتصفح اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».', 6500);
      };
      installButtons.forEach(button => button.addEventListener('click', promptInstall));

    updateInstallButton();
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      if (window.location.hostname.endsWith('.github.io')) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const cleanupRequested = sessionStorage.getItem('optics_sw_cleanup_requested') === 'true';
        if (registrations.length && !cleanupRequested) {
          sessionStorage.setItem('optics_sw_cleanup_requested', 'true');
          await Promise.all(registrations.map(registration => registration.unregister()));
          window.location.reload();
          return true;
        }
        if (!registrations.length) sessionStorage.removeItem('optics_sw_cleanup_requested');
      } else {
        navigator.serviceWorker.register('./sw.js').catch(error => console.warn('تعذر تسجيل Service Worker:', error));
      }
    }
    return false;
  }

  function openLoginModal() {
    const modal = document.getElementById('login-modal-backdrop');
    if (modal) {
      modal.classList.add('open');
      switchAuthTab('signin');
      const userInput = document.getElementById('login-username');
      if (userInput) userInput.focus();
    }
  }

  function closeLoginModal() {
    const modal = document.getElementById('login-modal-backdrop');
    if (modal) modal.classList.remove('open');
  }

  /**
   * تحديث اسم المنصة والقسم وبطاقة الهيرو التوضيحية
   */
  function setupAutoRefresh() {
    setInterval(async () => {
      if (document.hidden) return;
      try {
        const freshData = await window.DataLayer.loadData(true);
        if (!freshData || !state.data) return;

        const changed = JSON.stringify(state.data) !== JSON.stringify(freshData);
        if (changed) {
          state.data = freshData;
          updateGlobalBranding(freshData);
          renderPlatformFeatures();

          if (state.currentView === 'home') {
            renderHomeView();
          } else if (state.currentView === 'stage' && state.currentStageId) {
            renderStageView(state.currentStageId);
          } else if (state.currentView === 'about') {
            renderAboutView();
          }

          if (state.isAdmin) {
            updateAdminUI();
          }
        }
        if (state.isAdmin && state.currentView === 'admin' && !document.hidden) {
          await renderAdminUsersTable(true);
        }
      } catch (err) {
        console.warn('Auto refresh skipped:', err);
      }
    }, 15000);
  }

  function updateGlobalBranding(data) {
    if (!data) return;

    renderPlatformFeatures();

    // الهيدر
    const brandPlatformName = document.getElementById('brand-platform-name');
    if (brandPlatformName) brandPlatformName.textContent = data.platformName || 'منصة الامتحان المشترك';

    const brandDeptName = document.getElementById('brand-dept-name');
    if (brandDeptName) brandDeptName.textContent = data.department || 'قسم تقنيات البصريات';

    const yearBadge = document.getElementById('academic-year-badge');
    if (yearBadge) yearBadge.textContent = data.academicYear || '2026 - 2027';

    // نصوص الهيرو
    const kickerEl = document.getElementById('hero-kicker-text');
    if (kickerEl) kickerEl.textContent = data.heroKicker || 'الامتحان التقويمي الوزاري الموحد';

    const titleEl = document.getElementById('hero-title-text');
    if (titleEl) titleEl.textContent = data.heroTitle || 'كل ملفات الامتحان المشترك، في مكان واحد.';

    const subtitleEl = document.getElementById('hero-subtitle-text');
    if (subtitleEl) subtitleEl.textContent = data.heroSubtitle || '';

    // بطاقة قسم تقنيات البصريات التوضيحية
    const heroCardHeading = document.getElementById('hero-card-heading');
    if (heroCardHeading) heroCardHeading.textContent = data.heroCardHeading || data.department || 'قسم تقنيات البصريات';

    const heroCardText = document.getElementById('hero-card-text');
    if (heroCardText) heroCardText.textContent = data.heroCardText || 'الملفات المعتمدة وزارياً للامتحان المشترك، مصنفة بدقة حسب المراحل الأكاديمية.';

    const heroCardTags = document.getElementById('hero-card-tags');
    if (heroCardTags && Array.isArray(data.heroCardTags)) {
      heroCardTags.innerHTML = data.heroCardTags.map(tag => `<span>${tag}</span>`).join('<span>·</span>');
    }

    // شريط الضوابط والتعليمات
    const infoTitle = document.getElementById('info-banner-title');
    if (infoTitle) infoTitle.textContent = data.infoBannerTitle || 'ضوابط وتعليمات الامتحان المشترك';

    const infoSubtitle = document.getElementById('info-banner-subtitle');
    if (infoSubtitle) infoSubtitle.textContent = data.infoBannerSubtitle || 'نظام الامتحان التقويمي الصادر من وزارة التعليم العالي والبحث العلمي';

    const infoText = document.getElementById('info-banner-text');
    if (infoText) infoText.textContent = data.infoBannerText || '';

    // صفحة حول المنصة
    const aboutTitle = document.getElementById('about-page-title');
    if (aboutTitle) aboutTitle.textContent = data.aboutTitle || `منصة الامتحان المشترك – ${data.department || 'قسم تقنيات البصريات'}`;

    const aboutSubtitle = document.getElementById('about-page-subtitle');
    if (aboutSubtitle) aboutSubtitle.textContent = data.aboutSubtitle || 'Optics Common Exam Platform';

    const aboutBody = document.getElementById('about-page-body');
    if (aboutBody) aboutBody.textContent = data.aboutBody || '';

    // الإحصائيات
    const stats = window.DataLayer.getStats();
    const statStages = document.getElementById('stat-stages-count');
    const statSubjects = document.getElementById('stat-subjects-count');
    const statFiles = document.getElementById('stat-files-count');

    if (statStages) statStages.textContent = stats.stagesCount;
    if (statSubjects) statSubjects.textContent = stats.subjectsCount;
    if (statFiles) statFiles.textContent = stats.filesCount;
  }

  /**
   * عرض الصفحة الرئيسية
   */
  function renderPlatformFeatures() {
    const grid = document.getElementById('about-features-grid');
    if (!grid || !state.data) return;

    const features = Array.isArray(state.data.platformFeatures) ? state.data.platformFeatures.filter(item => item.enabled !== false) : [];
    const visible = !!state.data.showPlatformFeatures && features.length > 0;

    if (!visible) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = features.map(feature => `
      <div class="feature-box">
        <div class="feature-box-icon"><i data-lucide="${feature.icon || 'sparkles'}" style="width: 20px; height: 20px;"></i></div>
        <h4>${feature.title || 'ميزة جديدة'}</h4>
        <p>${feature.description || ''}</p>
      </div>
    `).join('');

    refreshIcons();
  }

  function renderHomeView() {
    state.currentView = 'home';
    showViewContainer('home-view');

    const stagesGrid = document.getElementById('stages-grid');
    if (!stagesGrid || !state.data) return;

    stagesGrid.innerHTML = '';

    state.data.stages.forEach(stage => {
      let filesCount = 0;
      if (Array.isArray(stage.subjects)) {
        stage.subjects.forEach(s => {
          if (Array.isArray(s.files)) filesCount += s.files.length;
        });
      }
      const subjectsCount = stage.subjects ? stage.subjects.length : 0;

      const card = document.createElement('div');
      card.className = 'stage-card';
      card.innerHTML = `
        <div>
          <div class="stage-top-meta">
            <div class="stage-icon-circle" style="background: ${stage.accentColor}18; color: ${stage.accentColor};">
              <i data-lucide="${stage.icon || 'book-open'}" style="width: 26px; height: 26px;"></i>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span class="stage-badge-pill" style="background: ${stage.accentColor}18; color: ${stage.accentColor};">${stage.badge || stage.name}</span>
              ${state.isAdmin ? `
                <button class="btn-inline-admin" title="تعديل المرحلة" data-admin-edit-stage="${stage.id}">
                  <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i>
                  <span>تعديل</span>
                </button>
              ` : ''}
            </div>
          </div>
          <h3 class="stage-name">${stage.name}</h3>
          <div class="stage-subtitle">${stage.subtitle || ''}</div>
          <p class="stage-desc">${stage.description || ''}</p>
        </div>
        <div class="stage-card-footer">
          <div class="stage-stats-meta">
            <span><strong>${subjectsCount}</strong> مواد</span>
            <span>·</span>
            <span><strong>${filesCount}</strong> ملفات</span>
          </div>
          <div class="stage-action-indicator">
            <span>تصفح المواد</span>
            <i data-lucide="chevron-left" style="width: 16px; height: 16px;"></i>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-admin-edit-stage]')) {
          e.stopPropagation();
          openEditStageModal(stage.id);
          return;
        }
        navigateToHash(`#stage/${stage.id}`);
      });

      stagesGrid.appendChild(card);
    });
  }

  /**
   * عرض مواد مرحلة دراسية محددة
   */
  function renderStageView(stageId) {
    state.currentView = 'stage';
    state.currentStageId = stageId;

    const stage = window.DataLayer.getStageById(stageId);
    if (!stage) {
      renderNotFoundView('المرحلة المطلوبة غير موجودة في قاعدة البيانات.');
      return;
    }

    showViewContainer('stage-view');

    const bcContainer = document.getElementById('stage-breadcrumb');
    if (bcContainer) {
      bcContainer.innerHTML = `
        <a href="#home" class="breadcrumb-item"><i data-lucide="home" style="width: 14px; height: 14px;"></i> الرئيسية</a>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-item active">${stage.name}</span>
      `;
    }

    const titleEl = document.getElementById('stage-view-title');
    const descEl = document.getElementById('stage-view-desc');
    if (titleEl) titleEl.textContent = stage.name;
    if (descEl) descEl.textContent = stage.description || '';

    const adminStageControls = document.getElementById('stage-admin-controls');
    if (adminStageControls) {
      if (state.isAdmin) {
        adminStageControls.style.display = 'flex';
        adminStageControls.innerHTML = `
          <button class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.825rem;" onclick="App.openAddSubjectModal('${stage.id}')">
            <i data-lucide="plus" style="width: 15px; height: 15px;"></i>
            <span>إضافة مادة جديدة</span>
          </button>
          <button class="btn-inline-admin" style="padding: 0.5rem 0.85rem;" onclick="App.openEditStageModal('${stage.id}')">
            <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
            <span>تعديل بيانات المرحلة</span>
          </button>
        `;
      } else {
        adminStageControls.style.display = 'none';
      }
    }

    const subjectsGrid = document.getElementById('stage-subjects-grid');
    if (!subjectsGrid) return;
    subjectsGrid.innerHTML = '';

    if (!stage.subjects || stage.subjects.length === 0) {
      subjectsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon-wrap"><i data-lucide="folder-x" style="width: 32px; height: 32px;"></i></div>
          <h4 class="empty-title">لا توجد مواد مضافة لهذه المرحلة حالياً</h4>
          <p class="empty-desc">يمكن للمشرف إضافة مواد جديدة من الزر أعلاه.</p>
        </div>
      `;
      return;
    }

    stage.subjects.forEach(subject => {
      const filesCount = subject.files ? subject.files.length : 0;
      const card = document.createElement('div');
      card.className = 'subject-card';
      card.innerHTML = `
        <div>
          <div class="subject-header">
            <div class="subject-icon-wrap" style="background: ${subject.color || '#7c3aed'}18; color: ${subject.color || '#7c3aed'};">
              <i data-lucide="${subject.icon || 'file-text'}" style="width: 24px; height: 24px;"></i>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              ${subject.code ? `<span class="subject-code-tag">${subject.code}</span>` : ''}
              ${state.isAdmin ? `
                <button class="btn-inline-admin" data-edit-sub="${subject.id}" title="تعديل المادة">
                  <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i>
                </button>
                <button class="btn-inline-admin-danger" data-del-sub="${subject.id}" title="حذف المادة">
                  <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                </button>
              ` : ''}
            </div>
          </div>
          <h3 class="subject-title">${subject.name}</h3>
          ${subject.nameEn ? `<div class="subject-title-en">${subject.nameEn}</div>` : ''}
          <p class="subject-desc">${subject.description || 'ملفات الامتحان المشترك والمحاضرات المقررة لهذه المادة.'}</p>
        </div>
        <div class="subject-footer">
          <div class="subject-file-counter">
            <i data-lucide="files" style="width: 16px; height: 16px;"></i>
            <span>${filesCount} ملفات متاحة</span>
          </div>
          <button class="btn-primary" style="padding: 0.55rem 1.15rem; font-size: 0.85rem;">
            <span>عرض الملفات</span>
            <i data-lucide="arrow-left" style="width: 15px; height: 15px;"></i>
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-edit-sub]')) {
          e.stopPropagation();
          openEditSubjectModal(stage.id, subject.id);
          return;
        }
        if (e.target.closest('[data-del-sub]')) {
          e.stopPropagation();
          if (confirm(`هل أنت متأكد من حذف مادة "${subject.name}" وجميع ملفاتها؟`)) {
            window.DataLayer.deleteSubject(stage.id, subject.id);
            renderStageView(stage.id);
            updateGlobalBranding(window.DataLayer.getData());
            showToast('تم حذف المادة بنجاح 🗑️');
          }
          return;
        }
        navigateToHash(`#subject/${stage.id}/${subject.id}`);
      });

      subjectsGrid.appendChild(card);
    });
  }

  /**
   * عرض ملفات مادة دراسية محددة
   */
  function renderSubjectView(stageId, subjectId) {
    state.currentView = 'subject';
    state.currentStageId = stageId;
    state.currentSubjectId = subjectId;

    const stage = window.DataLayer.getStageById(stageId);
    const subject = window.DataLayer.getSubjectById(stageId, subjectId);

    if (!stage || !subject) {
      renderNotFoundView('المادة أو المرحلة المطلوبة غير متوفرة.');
      return;
    }

    showViewContainer('subject-view');

    const bcContainer = document.getElementById('subject-breadcrumb');
    if (bcContainer) {
      bcContainer.innerHTML = `
        <a href="#home" class="breadcrumb-item"><i data-lucide="home" style="width: 14px; height: 14px;"></i> الرئيسية</a>
        <span class="breadcrumb-sep">/</span>
        <a href="#stage/${stage.id}" class="breadcrumb-item">${stage.name}</a>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-item active">${subject.name}</span>
      `;
    }

    const titleEl = document.getElementById('subject-view-title');
    const descEl = document.getElementById('subject-view-desc');
    const instructorEl = document.getElementById('subject-view-instructor');
    if (titleEl) titleEl.textContent = subject.name;
    if (descEl) descEl.textContent = subject.description || '';
    if (instructorEl) instructorEl.textContent = subject.instructor ? `إشراف: ${subject.instructor}` : '';

    const backBtn = document.getElementById('subject-back-to-stage');
    if (backBtn) {
      backBtn.onclick = () => navigateToHash(`#stage/${stage.id}`);
    }

    const adminSubjectControls = document.getElementById('subject-admin-controls');
    if (adminSubjectControls) {
      if (state.isAdmin) {
        adminSubjectControls.style.display = 'flex';
        adminSubjectControls.innerHTML = `
          <button class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.825rem;" onclick="App.openAddFileModal('${stage.id}', '${subject.id}')">
            <i data-lucide="plus" style="width: 15px; height: 15px;"></i>
            <span>إضافة محاضرة جديدة (أو من الجهاز)</span>
          </button>
          <button class="btn-inline-admin" style="padding: 0.5rem 0.85rem;" onclick="App.openEditSubjectModal('${stage.id}', '${subject.id}')">
            <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
            <span>تعديل المادة</span>
          </button>
        `;
      } else {
        adminSubjectControls.style.display = 'none';
      }
    }

    const filesListContainer = document.getElementById('subject-files-list');
    if (!filesListContainer) return;
    filesListContainer.innerHTML = '';

    if (!subject.files || subject.files.length === 0) {
      filesListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrap"><i data-lucide="file-question" style="width: 32px; height: 32px;"></i></div>
          <h4 class="empty-title">لا توجد ملفات مضافة لهذه المادة حالياً</h4>
          <p class="empty-desc">يمكن للمشرف رفع محاضرات من ملفات الجهاز أو إضافتها عبر الزر أعلاه.</p>
        </div>
      `;
      return;
    }

    const sortedFiles = [...subject.files].sort((a, b) => (a.number || 0) - (b.number || 0));

    sortedFiles.forEach(file => {
      const card = document.createElement('div');
      card.className = 'file-item-card';
      card.innerHTML = `
        <div class="file-info-main">
          <div class="file-pdf-icon-badge">
            <i data-lucide="file-text" style="width: 22px; height: 22px;"></i>
          </div>
          <div class="file-details">
            <div class="file-title-row">
              <span class="file-number-tag">ملف #${file.number || 1}</span>
              <h4 class="file-name">${file.title}</h4>
              ${file.isLocalUploaded ? '<span style="font-size: 0.7rem; background: var(--bg-surface-subtle); color: var(--accent); padding: 0.1rem 0.4rem; border-radius: 4px; font-weight: 600;">(مرفوع من الجهاز)</span>' : ''}
              ${state.isAdmin ? `
                <div class="inline-admin-controls" style="margin-right: 0.5rem;">
                  <button class="btn-inline-admin" data-edit-file="${file.id}" title="تعديل المحاضرة">
                    <i data-lucide="edit-3" style="width: 11px; height: 11px;"></i>
                    <span>تعديل</span>
                  </button>
                  <button class="btn-inline-admin-danger" data-del-file="${file.id}" title="حذف المحاضرة">
                    <i data-lucide="trash-2" style="width: 11px; height: 11px;"></i>
                    <span>حذف</span>
                  </button>
                </div>
              ` : ''}
            </div>
            ${file.description ? `<p class="file-desc-text">${file.description}</p>` : ''}
            <div class="file-meta-row">
              ${file.pages ? `<span>${file.pages} صفحة</span> <span>·</span>` : ''}
              ${file.size ? `<span>${file.size}</span> <span>·</span>` : ''}
              ${file.date ? `<span>تاريخ: ${file.date}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="file-actions-group">
          <button class="btn-file-read" data-action="read">
            <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
            <span>عرض الملف</span>
          </button>
          <button class="btn-file-action-icon" data-action="open-tab" title="فتح في نافذة جديدة">
            <i data-lucide="external-link" style="width: 16px; height: 16px;"></i>
          </button>
          <button class="btn-file-action-icon" data-action="download" title="تنزيل الملف">
            <i data-lucide="download" style="width: 16px; height: 16px;"></i>
          </button>
        </div>
      `;

      const readBtn = card.querySelector('[data-action="read"]');
      const openTabBtn = card.querySelector('[data-action="open-tab"]');
      const downloadBtn = card.querySelector('[data-action="download"]');
      const editBtn = card.querySelector('[data-edit-file]');
      const delBtn = card.querySelector('[data-del-file]');

      if (readBtn) {
        readBtn.addEventListener('click', () => {
          navigateToHash(`#file/${stage.id}/${subject.id}/${file.id}`);
        });
      }

      if (openTabBtn) {
        openTabBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(file.path, '_blank', 'noopener,noreferrer');
        });
      }

      if (downloadBtn) {
        downloadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const a = document.createElement('a');
          a.href = file.path;
          a.download = `${file.title}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          showToast(`جاري تنزيل: ${file.title}`);
        });
      }

      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditFileModal(stage.id, subject.id, file.id);
        });
      }

      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`هل أنت متأكد من حذف "${file.title}"؟`)) {
            window.DataLayer.deleteFile(stage.id, subject.id, file.id);
            renderSubjectView(stage.id, subject.id);
            updateGlobalBranding(window.DataLayer.getData());
            showToast('تم حذف المحاضرة بنجاح 🗑️');
          }
        });
      }

      filesListContainer.appendChild(card);
    });
  }

  /**
   * فتح قارئ PDF الداخلي
   */
  function renderPdfReaderView(stageId, subjectId, fileId) {
    state.currentView = 'pdf';
    state.currentStageId = stageId;
    state.currentSubjectId = subjectId;
    state.currentFileId = fileId;

    const stage = window.DataLayer.getStageById(stageId);
    const subject = window.DataLayer.getSubjectById(stageId, subjectId);
    const file = window.DataLayer.getFileById(stageId, subjectId, fileId);

    if (!stage || !subject || !file) {
      renderNotFoundView('ملف الامتحان المطلوب غير موجود.');
      return;
    }

    showViewContainer('pdf-view');

    const bcContainer = document.getElementById('pdf-breadcrumb');
    if (bcContainer) {
      bcContainer.innerHTML = `
        <a href="#home" class="breadcrumb-item"><i data-lucide="home" style="width: 14px; height: 14px;"></i> الرئيسية</a>
        <span class="breadcrumb-sep">/</span>
        <a href="#stage/${stage.id}" class="breadcrumb-item">${stage.name}</a>
        <span class="breadcrumb-sep">/</span>
        <a href="#subject/${stage.id}/${subject.id}" class="breadcrumb-item">${subject.name}</a>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-item active">${file.title}</span>
      `;
    }

    PDFViewer.loadDocument(file.path, {
      title: file.title,
      stageName: stage.name,
      subjectName: subject.name,
      fileNumber: file.number
    });
  }

  /**
   * عرض لوحة تحكم المشرف (Admin Control Center)
   */
  function renderAdminPanel() {
    if (!state.isAdmin) {
      openLoginModal();
      return;
    }
    state.currentView = 'admin';
    showViewContainer('admin-view');

    const data = window.DataLayer.getData();
    if (!data) return;

    // تعبئة نموذج الشاشة الرئيسية والبطاقة
    const pName = document.getElementById('admin-platform-name');
    const pDept = document.getElementById('admin-dept-name');
    const pFac = document.getElementById('admin-faculty-name');
    const pYear = document.getElementById('admin-academic-year');
    const hKicker = document.getElementById('admin-hero-kicker');
    const hTitle = document.getElementById('admin-hero-title');
    const hSubtitle = document.getElementById('admin-hero-subtitle');
    const hCardHeading = document.getElementById('admin-hero-card-heading');
    const hCardText = document.getElementById('admin-hero-card-text');
    const hCardTags = document.getElementById('admin-hero-card-tags');
    const iTitle = document.getElementById('admin-info-title');
    const iSubtitle = document.getElementById('admin-info-subtitle');
    const iText = document.getElementById('admin-info-text');

    if (pName) pName.value = data.platformName || '';
    if (pDept) pDept.value = data.department || '';
    if (pFac) pFac.value = data.faculty || '';
    if (pYear) pYear.value = data.academicYear || '';
    if (hKicker) hKicker.value = data.heroKicker || '';
    if (hTitle) hTitle.value = data.heroTitle || '';
    if (hSubtitle) hSubtitle.value = data.heroSubtitle || '';
    if (hCardHeading) hCardHeading.value = data.heroCardHeading || data.department || '';
    if (hCardText) hCardText.value = data.heroCardText || '';
    if (hCardTags) hCardTags.value = Array.isArray(data.heroCardTags) ? data.heroCardTags.join('، ') : '';
    if (iTitle) iTitle.value = data.infoBannerTitle || '';
    if (iSubtitle) iSubtitle.value = data.infoBannerSubtitle || '';
    if (iText) iText.value = data.infoBannerText || '';

    // تعبئة نموذج صفحة حول المنصة
    const abTitle = document.getElementById('admin-about-title');
    const abSubtitle = document.getElementById('admin-about-subtitle');
    const abBody = document.getElementById('admin-about-body');

    if (abTitle) abTitle.value = data.aboutTitle || '';
    if (abSubtitle) abSubtitle.value = data.aboutSubtitle || '';
    if (abBody) abBody.value = data.aboutBody || '';

    // عرض قائمة المراحل والمواد
    renderAdminStagesList();

    // عرض جدول المستخدمين
    renderAdminUsersTable();

    // تعبئة إعدادات نشر ومزامنة GitHub و Cloud Sync
    const ghCfg = window.DataLayer.getGitHubConfig();
    const ghRepo = document.getElementById('gh-repo-name');
    const ghBranch = document.getElementById('gh-branch-name');
    const ghToken = document.getElementById('gh-token-input');
    if (ghRepo && ghCfg.repo) ghRepo.value = ghCfg.repo;
    if (ghBranch && ghCfg.branch) ghBranch.value = ghCfg.branch;
    if (ghToken && ghCfg.token) ghToken.value = ghCfg.token;

    const cloudCfg = window.DataLayer.getCloudSyncConfig();
    const cUrl = document.getElementById('cloud-sync-url');
    const cKey = document.getElementById('cloud-sync-key');
    if (cUrl && cloudCfg.syncUrl) cUrl.value = cloudCfg.syncUrl;
    if (cKey && cloudCfg.apiKey) cKey.value = cloudCfg.apiKey;

    const showFeaturesToggle = document.getElementById('admin-show-platform-features');
    const featuresText = document.getElementById('admin-platform-features');
    if (showFeaturesToggle) showFeaturesToggle.checked = !!(data.showPlatformFeatures !== false);
    if (featuresText) {
      const features = Array.isArray(data.platformFeatures) ? data.platformFeatures : [];
      featuresText.value = features.map(item => `${item.title || 'ميزة جديدة'} | ${item.description || ''} | ${item.icon || 'sparkles'}`).join('\n');
    }

    updateDeploymentStatusBanner();
  }

  async function updateDeploymentStatusBanner() {
    const bannerTitle = document.getElementById('sync-banner-title');
    const bannerDesc = document.getElementById('sync-banner-desc');
    const iconBox = document.getElementById('sync-banner-icon-box');
    if (!bannerTitle || !bannerDesc) return;

    const serverStatus = await window.DataLayer.checkServerStatus();
    const ghCfg = window.DataLayer.getGitHubConfig();

    if (serverStatus.hasServer) {
      if (iconBox) {
        iconBox.style.background = 'var(--success)';
        iconBox.innerHTML = '<i data-lucide="server" style="width: 20px; height: 20px;"></i>';
      }
      bannerTitle.innerHTML = '🟢 المنصة متصلة بالسيرفر المباشر (Fullstack Active)';
      bannerDesc.innerHTML = 'الخادم المشترك نشط وجاهز. أي تعديل تقوم بحفظه في لوحة الإدارة يتم نشره ومزامنته فوراً وتلقائياً لجميع الطلبة على جميع أجهزتهم دون الحاجة لأي خطوة إضافية.';
    } else {
      if (iconBox) {
        iconBox.style.background = 'var(--accent)';
        iconBox.innerHTML = '<i data-lucide="globe" style="width: 20px; height: 20px;"></i>';
      }
      if (ghCfg && ghCfg.repo && ghCfg.token) {
        bannerTitle.innerHTML = '🌐 وضع GitHub Pages (مستعد للنشر المباشر بنقرة زر)';
        bannerDesc.innerHTML = `المستودع المرتبط: <strong>${ghCfg.repo}</strong>. بعد تعديل أي مادة أو إعداد، اضغط على زر <strong>«🚀 نشر للجميع على GitHub»</strong> ليتم تحديث المنصة للجميع فوراً.`;
      } else {
        bannerTitle.innerHTML = '⚠️ وضع الاستضافة الثابتة (GitHub Pages Static)';
        bannerDesc.innerHTML = 'لكي تظهر تعديلاتك لباقي الطلاب والأجهزة، يجب ربط مستودع GitHub أو استبدال ملف <code>exams.json</code>. انقر فوق زر «إعدادات النشر لـ GitHub» للاطلاع على الطريقتين وحل المشكلة فوراً.';
      }
    }
    refreshIcons();
  }

  function switchAdminTab(tabKey) {
    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
      if (btn.getAttribute('data-admin-tab') === tabKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    const panes = {
      'home-content': 'tab-pane-home-content',
      'about-content': 'tab-pane-about-content',
      'stages-subjects': 'tab-pane-stages-subjects',
      'users-management': 'tab-pane-users-management',
      'publish-sync': 'tab-pane-publish-sync'
    };

    Object.keys(panes).forEach(k => {
      const el = document.getElementById(panes[k]);
      if (el) el.style.display = k === tabKey ? 'block' : 'none';
    });
    refreshIcons();
  }

  async function handleHomeContentSubmit(e) {
    e.preventDefault();
    const platformName = document.getElementById('admin-platform-name').value;
    const department = document.getElementById('admin-dept-name').value;
    const faculty = document.getElementById('admin-faculty-name').value;
    const academicYear = document.getElementById('admin-academic-year').value;
    const heroKicker = document.getElementById('admin-hero-kicker').value;
    const heroTitle = document.getElementById('admin-hero-title').value;
    const heroSubtitle = document.getElementById('admin-hero-subtitle').value;
    const heroCardHeading = document.getElementById('admin-hero-card-heading').value;
    const heroCardText = document.getElementById('admin-hero-card-text').value;
    const heroCardTags = document.getElementById('admin-hero-card-tags').value;
    const infoBannerTitle = document.getElementById('admin-info-title').value;
    const infoBannerSubtitle = document.getElementById('admin-info-subtitle').value;
    const infoBannerText = document.getElementById('admin-info-text').value;

    const res = await window.DataLayer.updateAllUIElements({
      platformName,
      department,
      faculty,
      academicYear,
      heroKicker,
      heroTitle,
      heroSubtitle,
      heroCardHeading,
      heroCardText,
      heroCardTags,
      infoBannerTitle,
      infoBannerSubtitle,
      infoBannerText
    });

    state.data = window.DataLayer.getData();
    updateGlobalBranding(state.data);

    if (res && res.needsGitHubCommit) {
      showToast('تم الحفظ بنجاح! 💡 انقر «نشر للجميع على GitHub» لتصل التعديلات لكافة الطلبة', 5000);
    } else {
      showToast('تم حفظ جميع نصوص الشاشة الرئيسية وبطاقة القسم بنجاح ✅');
    }
    updateDeploymentStatusBanner();
  }

  async function handleAboutContentSubmit(e) {
    e.preventDefault();
    const aboutTitle = document.getElementById('admin-about-title').value;
    const aboutSubtitle = document.getElementById('admin-about-subtitle').value;
    const aboutBody = document.getElementById('admin-about-body').value;
    const showPlatformFeatures = document.getElementById('admin-show-platform-features').checked;
    const featuresText = document.getElementById('admin-platform-features').value.trim();

    let platformFeatures = undefined;
    if (featuresText) {
      platformFeatures = featuresText.split(/\n+/).filter(Boolean).map(line => {
        const parts = line.split('|').map(item => item.trim());
        return {
          title: parts[0] || 'ميزة جديدة',
          description: parts[1] || 'وصف الميزة',
          icon: parts[2] || 'sparkles',
          enabled: true
        };
      });
    }

    const res = await window.DataLayer.updateAllUIElements({
      aboutTitle,
      aboutSubtitle,
      aboutBody,
      showPlatformFeatures,
      platformFeatures
    });

    state.data = window.DataLayer.getData();
    updateGlobalBranding(state.data);

    if (res && res.needsGitHubCommit) {
      showToast('تم الحفظ بنجاح! 💡 انقر «نشر للجميع على GitHub» لتصل التعديلات لكافة الطلبة', 5000);
    } else {
      showToast('تم حفظ نصوص ومحتوى صفحة حول المنصة بنجاح ✅');
    }
    updateDeploymentStatusBanner();
  }

  async function handleGitHubSyncSubmit(e) {
    e.preventDefault();
    const repo = document.getElementById('gh-repo-name').value.trim();
    const branch = document.getElementById('gh-branch-name').value.trim() || 'main';
    const token = document.getElementById('gh-token-input').value.trim();
    const statusBox = document.getElementById('gh-publish-status-box');
    const submitBtn = document.getElementById('gh-publish-submit-btn');

    if (!repo || !token) {
      showToast('يرجى كتابة اسم المستودع ورمز الوصول Token', 3500);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width: 18px; height: 18px;"></i> <span>جاري النشر وتحديث مستودع GitHub...</span>';
      refreshIcons();
    }
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.style.background = 'var(--bg-surface-subtle)';
      statusBox.style.color = 'var(--text-secondary)';
      statusBox.style.border = '1px solid var(--border-medium)';
      statusBox.innerHTML = '⏳ جاري الاتصال بواجهة برمجة GitHub وتحديث ملف data/exams.json...';
    }

    try {
      const result = await window.DataLayer.publishToGitHub({ repo, token, branch });
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = 'rgba(16, 185, 129, 0.12)';
        statusBox.style.color = 'var(--success)';
        statusBox.style.border = '1.5px solid var(--success)';
        statusBox.innerHTML = `
          <div style="font-weight: 700; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
            <i data-lucide="check-circle" style="width: 18px; height: 18px;"></i>
            <span>✅ تم نشر التعديلات بنجاح إلى مستودع GitHub!</span>
          </div>
          <p style="margin-bottom: 0.5rem; font-size: 0.825rem; line-height: 1.5;">
            تم عمل Commit في الفرع <strong>${result.branch}</strong> بنجاح. سيقوم GitHub Pages تلقائياً بإعادة النشر وتظهر التعديلات لجميع الطلاب خلال 30 إلى 60 ثانية.
          </p>
          ${result.commitUrl ? `<a href="${result.commitUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent); font-weight: 600; text-decoration: underline; font-size: 0.8rem;">عرض الـ Commit على GitHub ↗</a>` : ''}
        `;
        refreshIcons();
      }
      showToast('تم نشر التعديلات لجميع الطلاب على GitHub بنجاح 🚀', 4000);
      updateDeploymentStatusBanner();
    } catch (err) {
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = 'rgba(239, 68, 68, 0.12)';
        statusBox.style.color = 'var(--danger)';
        statusBox.style.border = '1.5px solid var(--danger)';
        statusBox.innerHTML = `
          <div style="font-weight: 700; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
            <i data-lucide="alert-circle" style="width: 18px; height: 18px;"></i>
            <span>❌ فشل النشر إلى GitHub:</span>
          </div>
          <p style="font-size: 0.825rem; line-height: 1.5;">${err.message || 'حدث خطأ أثناء الاتصال بـ GitHub'}</p>
        `;
        refreshIcons();
      }
      showToast('فشل النشر إلى GitHub. تحقق من صحة المستودع والتوكن', 4000);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="cloud-upload" style="width: 18px; height: 18px;"></i> <span>🚀 نشر التعديلات فوراً لجميع الطلاب على GitHub</span>';
        refreshIcons();
      }
    }
  }

  async function handleQuickPublish() {
    const ghCfg = window.DataLayer.getGitHubConfig();
    if (!ghCfg || !ghCfg.repo || !ghCfg.token) {
      switchAdminTab('publish-sync');
      showToast('يرجى إدخال اسم المستودع والتوكن مرة واحدة فقط للنشر المباشر ⚙️', 4000);
      const repoInput = document.getElementById('gh-repo-name');
      if (repoInput) repoInput.focus();
      return;
    }

    const quickBtn = document.getElementById('quick-publish-gh-btn');
    if (quickBtn) {
      quickBtn.disabled = true;
      quickBtn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width: 14px; height: 14px;"></i> <span>جاري النشر...</span>';
      refreshIcons();
    }

    try {
      await window.DataLayer.publishToGitHub(ghCfg);
      showToast('تم نشر التعديلات لجميع الطلاب على GitHub بنجاح 🚀', 4000);
      updateDeploymentStatusBanner();
    } catch (err) {
      showToast(`تعذر النشر التلقائي: ${err.message}`, 4500);
      switchAdminTab('publish-sync');
    } finally {
      if (quickBtn) {
        quickBtn.disabled = false;
        quickBtn.innerHTML = '<i data-lucide="cloud-upload" style="width: 14px; height: 14px;"></i> <span>🚀 نشر للجميع على GitHub</span>';
        refreshIcons();
      }
    }
  }

  function handleCloudSyncSubmit(e) {
    e.preventDefault();
    const syncUrl = document.getElementById('cloud-sync-url').value.trim();
    const apiKey = document.getElementById('cloud-sync-key').value.trim();
    window.DataLayer.saveCloudSyncConfig({ syncUrl, apiKey });
    showToast('تم حفظ إعدادات المزامنة السحابية بنجاح ☁️');
  }

  async function handleTestGitHubConnection() {
    const repo = document.getElementById('gh-repo-name').value.trim();
    const branch = document.getElementById('gh-branch-name').value.trim() || 'main';
    const token = document.getElementById('gh-token-input').value.trim();
    const statusBox = document.getElementById('gh-publish-status-box');
    const testBtn = document.getElementById('gh-test-conn-btn');

    if (!repo || !token) {
      showToast('يرجى إدخال اسم المستودع والتوكن لإجراء الفحص ⚠️', 3500);
      return;
    }

    if (testBtn) {
      testBtn.disabled = true;
      testBtn.innerHTML = '<i data-lucide="loader-2" class="spin" style="width: 16px; height: 16px;"></i> <span>جاري فحص الاتصال...</span>';
      refreshIcons();
    }
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.style.background = 'var(--bg-surface-subtle)';
      statusBox.style.color = 'var(--text-secondary)';
      statusBox.style.border = '1px solid var(--border-medium)';
      statusBox.innerHTML = '⏳ جاري التحقق من المستودع وصلاحية الـ Token...';
    }

    try {
      const res = await window.DataLayer.testGitHubConnection({ repo, token, branch });
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = 'rgba(16, 185, 129, 0.12)';
        statusBox.style.color = 'var(--success)';
        statusBox.style.border = '1.5px solid var(--success)';
        statusBox.innerHTML = `
          <div style="font-weight: 700; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
            <i data-lucide="check-circle-2" style="width: 18px; height: 18px;"></i>
            <span>✅ الاتصال بالمستودع ناجح والـ Token سليم ومفعّل!</span>
          </div>
          <p style="font-size: 0.825rem; line-height: 1.5; margin-bottom: 0.25rem;">
            المستودع: <strong>${res.repoFullName}</strong> (${res.isPrivate ? 'خاص Private' : 'عام Public'}) · الفرع المحدد: <strong>${res.branchName}</strong> ${res.branchExists ? '✔ موجود وجاهز' : '⚠️ غير موجود بعد'}.
          </p>
          <span style="font-size: 0.775rem; color: var(--text-muted);">
            جاهز للنشر الآن! يمكنك الضغط على زر «🚀 نشر التعديلات فوراً لجميع الطلاب على GitHub».
          </span>
        `;
        refreshIcons();
      }
      showToast('تم التحقق بنجاح! الاتصال بالمستودع سليم ومؤكد ✔️', 3500);
      window.DataLayer.saveGitHubConfig({ repo, token, branch });
    } catch (err) {
      if (statusBox) {
        statusBox.style.display = 'block';
        statusBox.style.background = 'rgba(239, 68, 68, 0.12)';
        statusBox.style.color = 'var(--danger)';
        statusBox.style.border = '1.5px solid var(--danger)';
        statusBox.innerHTML = `
          <div style="font-weight: 700; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
            <i data-lucide="alert-circle" style="width: 18px; height: 18px;"></i>
            <span>❌ فشل الاتصال بالمستودع:</span>
          </div>
          <p style="font-size: 0.825rem; line-height: 1.5;">${err.message || 'تعذر التحقق من بيانات المستودع والتوكن.'}</p>
        `;
        refreshIcons();
      }
      showToast('فشل فحص الاتصال: ' + err.message, 4500);
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.innerHTML = '<i data-lucide="check-check" style="width: 16px; height: 16px;"></i> <span>🔍 فحص واختبار الاتصال والتوكن</span>';
        refreshIcons();
      }
    }
  }

  async function downloadFullProjectZip() {
    if (typeof JSZip === 'undefined') {
      showToast('جاري تحميل أداة حزم الملفات (JSZip)... يرجى الانتظار 3 ثوانٍ والمحاولة مرة أخرى', 3500);
      return;
    }

    showGlobalLoading(true);
    showToast('جاري تجهيز وحزم ملفات المشروع كاملة بصيغة ZIP... 📦', 3000);

    try {
      const zip = new JSZip();

      // الملفات النصية الأساسية المراد جلبها وحزمها
      const textFiles = [
        'index.html',
        'README.md',
        'assets/css/style.css',
        'assets/images/logo.svg',
        'assets/js/app.js',
        'assets/js/data.js',
        'assets/js/search.js',
        'assets/js/pdf-viewer.js'
      ];

      for (const filePath of textFiles) {
        try {
          const res = await fetch(filePath + `?_t=${Date.now()}`);
          if (res.ok) {
            const content = await res.text();
            zip.file(filePath, content);
          }
        } catch (e) {
          console.warn('Could not fetch file for zip:', filePath, e);
        }
      }

      // إضافة أحدث ملف exams.json الحالي من الذاكرة
      const currentData = window.DataLayer.getData();
      zip.file('data/exams.json', JSON.stringify(currentData, null, 2));

      // جلب عينات ملفات الـ PDF
      const pdfFiles = [
        'files/stage-2/subject-1/lecture-01.pdf',
        'files/stage-2/subject-1/lecture-02.pdf',
        'files/stage-2/subject-2/lecture-01.pdf',
        'files/stage-3/subject-1/lecture-01.pdf',
        'files/stage-4/subject-1/lecture-01.pdf'
      ];
      for (const pdfPath of pdfFiles) {
        try {
          const res = await fetch(pdfPath);
          if (res.ok) {
            const blob = await res.blob();
            zip.file(pdfPath, blob);
          }
        } catch (e) {}
      }

      const zipContent = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipContent);
      a.download = 'optics-common-exam-platform-github-ready.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      showToast('تم تحميل حزمة المشروع كاملة بنجاح 📦! فك الضغط وارفعها لمستودعك على GitHub', 6000);
    } catch (err) {
      console.error('ZIP Error:', err);
      showToast('حدث خطأ أثناء حزم الملفات: ' + err.message, 4500);
    } finally {
      showGlobalLoading(false);
    }
  }

  function copyGitCommands() {
    const ghCfg = window.DataLayer.getGitHubConfig();
    const repoSlug = (ghCfg && ghCfg.repo) ? ghCfg.repo : 'YOUR_USERNAME/optics-common-exam';
    const commands = `# خطوات رفع المشروع لأول مرة على GitHub:
git init
git add .
git commit -m "Optics Exam Platform - Initial Release"
git branch -M main
git remote add origin https://github.com/${repoSlug}.git
git push -u origin main

# بعد الرفع، ادخل إلى Settings > Pages في المستودع واختر فرع main لتشغيل الموقع!`;

    navigator.clipboard.writeText(commands).then(() => {
      showToast('تم نسخ أوامر Git الجاهزة للحافظة 📋', 4000);
    }).catch(() => {
      prompt('انسخ أوامر Git التالية لرفع المشروع:', commands);
    });
  }

  function openGitHubRepoDataFolder() {
    const repoInput = document.getElementById('gh-repo-name');
    const branchInput = document.getElementById('gh-branch-name');
    let repo = repoInput ? repoInput.value.trim() : '';
    let branch = branchInput ? branchInput.value.trim() || 'main' : 'main';

    if (!repo) {
      const ghCfg = window.DataLayer.getGitHubConfig();
      if (ghCfg && ghCfg.repo) repo = ghCfg.repo;
    }

    if (!repo) {
      showToast('يرجى كتابة اسم مستودعك أولاً (مثال: username/repo) في حقل المستودع بالأعلى ⚠️', 4500);
      if (repoInput) repoInput.focus();
      return;
    }

    let cleanRepo = repo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const url = `https://github.com/${cleanRepo}/tree/${branch}/data`;
    window.open(url, '_blank');
    showToast('تم فتح مجلد data في مستودع GitHub في نافذة جديدة ↗️', 3500);
  }

  function copyJsonToClipboard() {
    const currentData = window.DataLayer.getData();
    if (!currentData) return;
    const jsonStr = JSON.stringify(currentData, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      showToast('تم نسخ كود exams.json بالكامل للحافظة بنجاح 📋', 3500);
    }).catch(() => {
      showToast('تعذر النسخ التلقائي للحافظة', 3000);
    });
  }

  function renderAdminStagesList() {
    const container = document.getElementById('admin-stages-list-wrap');
    if (!container) return;
    const data = window.DataLayer.getData();
    if (!data || !data.stages) return;

    container.innerHTML = '';
    data.stages.forEach(stage => {
      const stageCard = document.createElement('div');
      stageCard.className = 'admin-card-container';
      stageCard.style.padding = '1.25rem';
      stageCard.style.marginBottom = '1.25rem';
      stageCard.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--accent);">${stage.name}</h4>
            <span style="font-size: 0.8rem; color: var(--text-muted);">${stage.subtitle || ''}</span>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-inline-admin" onclick="App.openEditStageModal('${stage.id}')">
              <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
              <span>تعديل المرحلة</span>
            </button>
            <button class="btn-primary" style="padding: 0.4rem 0.85rem; font-size: 0.775rem;" onclick="App.openAddSubjectModal('${stage.id}')">
              <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
              <span>+ إضافة مادة</span>
            </button>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${stage.subjects && stage.subjects.length > 0 ? stage.subjects.map(sub => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: var(--bg-surface-subtle); border-radius: 10px; border: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <span style="font-weight: 700; font-size: 0.95rem;">${sub.name}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted); margin-right: 0.5rem;">(${sub.files ? sub.files.length : 0} محاضرات)</span>
              </div>
              <div style="display: flex; gap: 0.4rem;">
                <button class="btn-inline-admin" onclick="App.openAddFileModal('${stage.id}', '${sub.id}')">
                  <i data-lucide="file-plus" style="width: 13px; height: 13px;"></i>
                  <span>+ محاضرة / رفع من الجهاز</span>
                </button>
                <button class="btn-inline-admin" onclick="App.openEditSubjectModal('${stage.id}', '${sub.id}')">
                  <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
                  <span>تعديل</span>
                </button>
                <button class="btn-inline-admin-danger" onclick="App.deleteSubjectConfirm('${stage.id}', '${sub.id}', '${sub.name}')">
                  <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                  <span>حذف</span>
                </button>
              </div>
            </div>
            <div style="margin: 0 0.75rem 0.75rem; padding: 0.75rem; border-right: 2px solid var(--border-medium); display: flex; flex-direction: column; gap: 0.5rem;">
              ${sub.files && sub.files.length > 0 ? sub.files.map(file => `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; padding: 0.65rem 0.8rem; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px;">
                  <div style="min-width: 0; flex: 1;">
                    <span style="display: inline-block; margin-left: 0.4rem; padding: 0.1rem 0.45rem; border-radius: 6px; background: var(--accent-light); color: var(--accent); font-size: 0.75rem; font-weight: 700;">رقم ${file.number}</span>
                    <span style="font-size: 0.85rem; font-weight: 600; overflow-wrap: anywhere;">${file.title}</span>
                  </div>
                  <div style="display: flex; gap: 0.35rem; flex-shrink: 0;">
                    <button class="btn-inline-admin" onclick="App.openEditFileModal('${stage.id}', '${sub.id}', '${file.id}')" title="تعديل اسم أو رقم الملف">
                      <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i><span>تعديل</span>
                    </button>
                    <button class="btn-inline-admin-danger" onclick="App.deleteFileConfirm('${stage.id}', '${sub.id}', '${file.id}')" title="حذف الملف">
                      <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i><span>حذف</span>
                    </button>
                  </div>
                </div>
              `).join('') : '<p style="font-size: 0.8rem; color: var(--text-muted);">لا توجد ملفات أو محاضرات لهذه المادة بعد.</p>'}
            </div>
          `).join('') : '<p style="font-size: 0.85rem; color: var(--text-muted);">لا توجد مواد مضافة في هذه المرحلة حالياً.</p>'}
        </div>
      `;
      container.appendChild(stageCard);
    });
    refreshIcons();
  }

  /**
   * إدارة حسابات المستخدمين والطلاب في لوحة الإدارة
   */
  async function renderAdminUsersTable(forceRefresh = true) {
    const tbody = document.getElementById('admin-users-table-body');
    if (!tbody) return;
    const users = await window.DataLayer.getRegisteredUsers(forceRefresh);

    if (forceRefresh && !window.DataLayer.hasSharedUserServer()) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2rem; color: var(--warning);">
            خادم الحسابات غير متاح. GitHub Pages لا يدعم حفظ الحسابات المشتركة؛ شغّل الموقع على خادم Node.js لعرض حسابات جميع الأجهزة.
          </td>
        </tr>
      `;
      return;
    }
    if (forceRefresh && window.DataLayer.getUsersApiError()) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2rem; color: var(--warning);">
            ${window.DataLayer.getUsersApiError()} ${window.DataLayer.getUsersApiError().includes('المشرف') ? 'سجّل الخروج ثم ادخل مجدداً لتحديث صلاحية لوحة الإدارة.' : ''}
          </td>
        </tr>
      `;
      return;
    }

    if (users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            لا توجد حسابات طلاب مسجلة حتى الآن. يمكنك إضافة حساب بالضغط على زر «إنشاء حساب طالب جديد».
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 700; color: var(--text-primary); font-family: monospace;">${u.username}</td>
        <td>${u.fullName || '-'}</td>
        <td><span class="file-number-tag">${u.stage || 'المرحلة الثانية'}</span></td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${u.createdAt || '-'}</td>
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <button class="btn-inline-admin" onclick="App.openEditUserModal('${u.id}')">
              <i data-lucide="key" style="width: 13px; height: 13px;"></i>
              <span>تغيير الرمز/اليوزر</span>
            </button>
            <button class="btn-inline-admin-danger" onclick="App.deleteUserConfirm('${u.id}', '${u.username}')">
              <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
              <span>حذف</span>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    refreshIcons();
  }

  function openAddUserModal() {
    openUniversalModal({
      title: 'إنشاء حساب طالب جديد',
      fields: [
        { id: 'm_user_fullname', label: 'الاسم الكامل للطالب', placeholder: 'مثال: سجاد حيدر علي' },
        { id: 'm_user_username', label: 'اسم المستخدم (يوزر نيم)', placeholder: 'sajjad_optics' },
        { id: 'm_user_password', label: 'رمز المرور (كلمة السر)', placeholder: '12345678' },
        { id: 'm_user_stage', label: 'المرحلة الدراسية', value: 'المرحلة الثانية' }
      ],
      onSubmit: async (vals) => {
        const res = await window.DataLayer.registerUser({
          username: vals.m_user_username,
          password: vals.m_user_password,
          fullName: vals.m_user_fullname,
          stage: vals.m_user_stage
        }, false);
        if (res.success) {
          localStorage.setItem('optics_account_created', 'true');
          updateInstallButton();
          await renderAdminUsersTable(false);
          showToast(`تم إنشاء حساب ${vals.m_user_fullname} بنجاح ✨`);
        } else {
          showToast(res.message || 'تعذر إنشاء الحساب.', 4500);
        }
      }
    });
  }

  async function openEditUserModal(userId) {
    const users = await window.DataLayer.getRegisteredUsers(false);
    const user = users.find(u => u.id === userId);
    if (!user) return;

    openUniversalModal({
      title: `تعديل حساب ${user.fullName || user.username}`,
      fields: [
        { id: 'm_user_fullname', label: 'الاسم الكامل', value: user.fullName || '' },
        { id: 'm_user_username', label: 'اسم المستخدم (يوزر نيم)', value: user.username },
        { id: 'm_user_password', label: 'رمز مرور جديد (اتركه فارغاً دون تغيير)', value: '', required: false },
        { id: 'm_user_stage', label: 'المرحلة الدراسية', value: user.stage || 'المرحلة الثانية' }
      ],
      onSubmit: async (vals) => {
        const res = await window.DataLayer.updateUser(userId, {
          username: vals.m_user_username,
          password: vals.m_user_password,
          fullName: vals.m_user_fullname,
          stage: vals.m_user_stage
        });
        if (res.success) {
          await renderAdminUsersTable(false);
          showToast('تم تعديل بيانات الحساب والرمز بنجاح 🔑');
        } else {
          showToast(res.message || 'تعذر تحديث بيانات الحساب.', 4500);
        }
      }
    });
  }

  async function deleteUserConfirm(userId, username) {
    if (confirm(`هل أنت متأكد من حذف حساب الطالب "${username}"؟`)) {
      const deleted = await window.DataLayer.deleteUser(userId);
      await renderAdminUsersTable(false);
      showToast(deleted ? 'تم حذف الحساب بنجاح 🗑️' : 'تعذر حذف الحساب من الخادم.', 4000);
    }
  }

  /**
   * إضافة محاضرة مع دعم رفع ملف PDF من ملفات الجهاز
   */
  function openAddFileModal(stageId, subjectId) {
    const subject = window.DataLayer.getSubjectById(stageId, subjectId);
    if (!subject) return;
    const nextNum = (subject.files ? subject.files.length : 0) + 1;

    let localUploadedDataUrl = '';
    let localUploadedFileName = '';
    let localUploadedSize = '';

    openUniversalModal({
      title: `إضافة محاضرة إلى ${subject.name}`,
      customHeaderHtml: `
        <div style="background: var(--bg-surface-subtle); padding: 1rem; border-radius: 12px; border: 1.5px dashed var(--accent); margin-bottom: 1.25rem;">
          <div style="font-weight: 700; color: var(--accent); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
            <i data-lucide="upload" style="width: 16px; height: 16px;"></i>
            <span>تخصيص مكان لرفع الملف من ملفات جهازك (اختياري)</span>
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">
            اضغط لاختيار ملف PDF من الكمبيوتر أو الهاتف وسيتم تجهيزه وقراءته فوراً داخل الموقع:
          </p>
          <input type="file" id="modal_device_pdf_picker" accept="application/pdf,.pdf" style="font-size: 0.85rem;" />
          <div id="device_file_badge" style="display: none; margin-top: 0.5rem;" class="file-preview-pill">
            <i data-lucide="file-check" style="width: 14px; height: 14px;"></i>
            <span id="device_file_name_txt"></span>
          </div>
        </div>
      `,
      onAfterRender: () => {
        const fileInput = document.getElementById('modal_device_pdf_picker');
        if (fileInput) {
          fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (loadEvt) => {
                localUploadedDataUrl = loadEvt.target.result;
                localUploadedFileName = file.name;
                localUploadedSize = (file.size / (1024 * 1024)).toFixed(1) + ' MB';

                // تعبئة الحقول تلقائياً
                const titleInput = document.getElementById('m_file_title');
                const pathInput = document.getElementById('m_file_path');
                const sizeInput = document.getElementById('m_file_size');
                const badge = document.getElementById('device_file_badge');
                const badgeTxt = document.getElementById('device_file_name_txt');

                if (titleInput && (!titleInput.value || titleInput.value.startsWith('المحاضرة'))) {
                  titleInput.value = file.name.replace(/\.pdf$/i, '');
                }
                if (pathInput) pathInput.value = `[ملف محلي مرفوع]: ${file.name}`;
                if (sizeInput) sizeInput.value = localUploadedSize;
                if (badge && badgeTxt) {
                  badgeTxt.textContent = `${file.name} (${localUploadedSize})`;
                  badge.style.display = 'inline-flex';
                }
                refreshIcons();
              };
              reader.readAsDataURL(file);
            }
          });
        }
      },
      fields: [
        { id: 'm_file_num', label: 'رقم المحاضرة', value: nextNum, type: 'number' },
        { id: 'm_file_title', label: 'عنوان المحاضرة', placeholder: `المحاضرة 0${nextNum}: عنوان الموضوع` },
        { id: 'm_file_desc', label: 'وصف المحاضرة (اختياري)', type: 'textarea', placeholder: 'ملخص المفاهيم والمسائل...' },
        { id: 'm_file_path', label: 'مسار الملف النسبي (أو يتم ملؤه بالملف المرفوع)', value: `files/${stageId}/${subjectId.replace(stageId + '-', '')}/lecture-0${nextNum}.pdf` },
        { id: 'm_file_pages', label: 'عدد الصفحات', value: 16, type: 'number' },
        { id: 'm_file_size', label: 'حجم الملف التقديري', value: '2.8 MB' },
        { id: 'm_file_date', label: 'تاريخ الإضافة', value: new Date().toISOString().split('T')[0] }
      ],
      onSubmit: async (vals) => {
        showGlobalLoading(true);
        const finalPath = localUploadedDataUrl ? localUploadedDataUrl : vals.m_file_path;
        await window.DataLayer.addFile(stageId, subjectId, {
          number: vals.m_file_num,
          title: vals.m_file_title,
          description: vals.m_file_desc,
          path: finalPath,
          filename: localUploadedFileName || `${vals.m_file_title}.pdf`,
          base64Data: localUploadedDataUrl,
          pages: vals.m_file_pages,
          size: vals.m_file_size,
          date: vals.m_file_date,
          isLocalUploaded: !!localUploadedDataUrl
        });
        showGlobalLoading(false);
        state.data = window.DataLayer.getData();
        updateGlobalBranding(state.data);
        renderAdminStagesList();
        handleHashChange();
        showToast('تمت إضافة المحاضرة ونشرها لجميع المستخدمين بنجاح 📄');
      }
    });
  }

  function openEditFileModal(stageId, subjectId, fileId) {
    const file = window.DataLayer.getFileById(stageId, subjectId, fileId);
    if (!file) return;

    let localUploadedDataUrl = '';
    let localUploadedSize = '';

    openUniversalModal({
      title: `تعديل ${file.title}`,
      customHeaderHtml: `
        <div style="background: var(--bg-surface-subtle); padding: 1rem; border-radius: 12px; border: 1.5px dashed var(--accent); margin-bottom: 1.25rem;">
          <div style="font-weight: 700; color: var(--accent); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
            <i data-lucide="upload" style="width: 16px; height: 16px;"></i>
            <span>تحديث الملف من ملفات الجهاز (اختياري)</span>
          </div>
          <input type="file" id="modal_edit_pdf_picker" accept="application/pdf,.pdf" style="font-size: 0.85rem;" />
        </div>
      `,
      onAfterRender: () => {
        const fileInput = document.getElementById('modal_edit_pdf_picker');
        if (fileInput) {
          fileInput.addEventListener('change', e => {
            const f = e.target.files[0];
            if (f) {
              const reader = new FileReader();
              reader.onload = (loadEvt) => {
                localUploadedDataUrl = loadEvt.target.result;
                localUploadedSize = (f.size / (1024 * 1024)).toFixed(1) + ' MB';
                const sizeInput = document.getElementById('m_file_size');
                const pathInput = document.getElementById('m_file_path');
                if (sizeInput) sizeInput.value = localUploadedSize;
                if (pathInput) pathInput.value = `[ملف محلي مرفوع]: ${f.name}`;
              };
              reader.readAsDataURL(f);
            }
          });
        }
      },
      fields: [
        { id: 'm_file_num', label: 'رقم المحاضرة', value: file.number, type: 'number' },
        { id: 'm_file_title', label: 'عنوان المحاضرة', value: file.title },
        { id: 'm_file_desc', label: 'وصف المحاضرة', type: 'textarea', value: file.description || '' },
        { id: 'm_file_path', label: 'مسار ملف الـ PDF', value: file.isLocalUploaded ? '[ملف محلي محفوظ في المتصفح]' : file.path },
        { id: 'm_file_pages', label: 'عدد الصفحات', value: file.pages || 1, type: 'number' },
        { id: 'm_file_size', label: 'حجم الملف', value: file.size || '' },
        { id: 'm_file_date', label: 'تاريخ الإضافة', value: file.date || '' }
      ],
      onSubmit: async (vals) => {
        showGlobalLoading(true);
        const finalPath = localUploadedDataUrl ? localUploadedDataUrl : (vals.m_file_path.includes('[ملف محلي') ? file.path : vals.m_file_path);
        await window.DataLayer.updateFile(stageId, subjectId, fileId, {
          number: vals.m_file_num,
          title: vals.m_file_title,
          description: vals.m_file_desc,
          path: finalPath,
          filename: localUploadedFileName || `${vals.m_file_title}.pdf`,
          base64Data: localUploadedDataUrl,
          pages: vals.m_file_pages,
          size: vals.m_file_size,
          date: vals.m_file_date,
          isLocalUploaded: localUploadedDataUrl ? true : file.isLocalUploaded
        });
        showGlobalLoading(false);
        state.data = window.DataLayer.getData();
        updateGlobalBranding(state.data);
        renderAdminStagesList();
        handleHashChange();
        showToast('تم تعديل المحاضرة ونشرها لجميع المستخدمين بنجاح ✏️');
      }
    });
  }

  async function deleteFileConfirm(stageId, subjectId, fileId) {
    const file = window.DataLayer.getFileById(stageId, subjectId, fileId);
    if (!file || !confirm(`هل أنت متأكد من حذف الملف «${file.title}»؟`)) return;

    await window.DataLayer.deleteFile(stageId, subjectId, fileId);
    state.data = window.DataLayer.getData();
    updateGlobalBranding(state.data);
    renderAdminStagesList();
    if (state.currentView === 'subject') renderSubjectView(stageId, subjectId);
    showToast('تم حذف الملف بنجاح 🗑️');
  }

  function openEditStageModal(stageId) {
    const stage = window.DataLayer.getStageById(stageId);
    if (!stage) return;
    openUniversalModal({
      title: `تعديل بيانات ${stage.name}`,
      fields: [
        { id: 'm_stage_name', label: 'اسم المرحلة', value: stage.name },
        { id: 'm_stage_subtitle', label: 'العنوان الفرعي', value: stage.subtitle || '' },
        { id: 'm_stage_badge', label: 'شارة المرحلة', value: stage.badge || '' },
        { id: 'm_stage_desc', label: 'الوصف الأكاديمي', type: 'textarea', value: stage.description || '' },
        { id: 'm_stage_color', label: 'اللون المميز (HEX)', value: stage.accentColor || '#7c3aed' }
      ],
      onSubmit: (vals) => {
        window.DataLayer.updateStage(stageId, {
          name: vals.m_stage_name,
          subtitle: vals.m_stage_subtitle,
          badge: vals.m_stage_badge,
          description: vals.m_stage_desc,
          accentColor: vals.m_stage_color
        });
        state.data = window.DataLayer.getData();
        updateGlobalBranding(state.data);
        handleHashChange();
        showToast('تم تعديل بيانات المرحلة بنجاح ✨');
      }
    });
  }

  function openAddSubjectModal(stageId) {
    const stage = window.DataLayer.getStageById(stageId);
    if (!stage) return;
    openUniversalModal({
      title: `إضافة مادة جديدة إلى ${stage.name}`,
      fields: [
        { id: 'm_sub_name', label: 'اسم المادة بالعربية', placeholder: 'مثال: البصريات الفيزيائية' },
        { id: 'm_sub_name_en', label: 'اسم المادة بالإنجليزية (اختياري)', placeholder: 'Physical Optics', required: false },
        { id: 'm_sub_code', label: 'رمز المادة الأكاديمي', placeholder: 'OPT-201' },
        { id: 'm_sub_instructor', label: 'أستاذ المادة المشترك', placeholder: 'أستاذ المادة المشترك' },
        { id: 'm_sub_desc', label: 'وصف مفردات المادة (اختياري)', type: 'textarea', placeholder: 'ملخص مواضيع الامتحان المشترك...', required: false },
        { id: 'm_sub_color', label: 'اللون المميز (اختياري)', type: 'color', value: '#7c3aed', required: false }
      ],
      onSubmit: (vals) => {
        window.DataLayer.addSubject(stageId, {
          name: vals.m_sub_name,
          nameEn: vals.m_sub_name_en,
          code: vals.m_sub_code,
          instructor: vals.m_sub_instructor,
          description: vals.m_sub_desc,
          color: vals.m_sub_color
        });
        state.data = window.DataLayer.getData();
        updateGlobalBranding(state.data);
        handleHashChange();
        showToast('تمت إضافة المادة بنجاح 📚');
      }
    });
  }

  function openEditSubjectModal(stageId, subjectId) {
    const subject = window.DataLayer.getSubjectById(stageId, subjectId);
    if (!subject) return;
    openUniversalModal({
      title: `تعديل مادة ${subject.name}`,
      fields: [
        { id: 'm_sub_name', label: 'اسم المادة بالعربية', value: subject.name },
        { id: 'm_sub_name_en', label: 'اسم المادة بالإنجليزية (اختياري)', value: subject.nameEn || '', required: false },
        { id: 'm_sub_code', label: 'رمز المادة', value: subject.code || '' },
        { id: 'm_sub_instructor', label: 'أستاذ المادة', value: subject.instructor || '' },
        { id: 'm_sub_desc', label: 'الوصف (اختياري)', type: 'textarea', value: subject.description || '', required: false },
        { id: 'm_sub_color', label: 'اللون المميز (اختياري)', type: 'color', value: subject.color || '#7c3aed', required: false }
      ],
      onSubmit: (vals) => {
        window.DataLayer.updateSubject(stageId, subjectId, {
          name: vals.m_sub_name,
          nameEn: vals.m_sub_name_en,
          code: vals.m_sub_code,
          instructor: vals.m_sub_instructor,
          description: vals.m_sub_desc,
          color: vals.m_sub_color
        });
        state.data = window.DataLayer.getData();
        updateGlobalBranding(state.data);
        handleHashChange();
        showToast('تم تحديث بيانات المادة بنجاح ✏️');
      }
    });
  }

  function deleteSubjectConfirm(stageId, subjectId, subjectName) {
    if (confirm(`هل أنت متأكد من حذف مادة "${subjectName}" نهائياً؟`)) {
      window.DataLayer.deleteSubject(stageId, subjectId);
      state.data = window.DataLayer.getData();
      updateGlobalBranding(state.data);
      renderAdminStagesList();
      showToast('تم حذف المادة بنجاح 🗑️');
    }
  }

  /**
   * مشغّل النوافذ المنبثقة العامة (Universal Modal Builder)
   */
  function openUniversalModal({ title, fields, customHeaderHtml, onAfterRender, onSubmit }) {
    const modal = document.getElementById('edit-modal-backdrop');
    const titleEl = document.getElementById('edit-modal-title');
    const form = document.getElementById('edit-modal-form');
    const fieldsWrap = document.getElementById('edit-modal-fields');

    if (!modal || !form || !fieldsWrap) return;
    if (titleEl) titleEl.textContent = title;
    fieldsWrap.innerHTML = customHeaderHtml || '';

    fields.forEach(f => {
      const g = document.createElement('div');
      g.className = 'admin-form-group';
      g.innerHTML = `
        <label class="admin-form-label" for="${f.id}">${f.label}</label>
        ${f.type === 'textarea' ? `
          <textarea id="${f.id}" class="admin-form-textarea" rows="3" placeholder="${f.placeholder || ''}" ${f.required === false ? '' : 'required'}>${f.value || ''}</textarea>
        ` : `
          <input id="${f.id}" type="${f.type || 'text'}" class="admin-form-input" value="${f.value !== undefined ? f.value : ''}" placeholder="${f.placeholder || ''}" ${f.required !== false ? 'required' : ''} />
        `}
      `;
      fieldsWrap.appendChild(g);
    });

    if (onAfterRender) onAfterRender();

    form.onsubmit = (e) => {
      e.preventDefault();
      const vals = {};
      fields.forEach(f => {
        const inp = document.getElementById(f.id);
        vals[f.id] = inp ? inp.value : '';
      });
      closeEditModal();
      if (onSubmit) onSubmit(vals);
    };

    modal.classList.add('open');
    refreshIcons();
  }

  function closeEditModal() {
    const modal = document.getElementById('edit-modal-backdrop');
    if (modal) modal.classList.remove('open');
  }

  function renderAboutView() {
    state.currentView = 'about';
    showViewContainer('about-view');
  }

  function renderNotFoundView(msg = 'الصفحة أو الرابط المطلوب غير موجود.') {
    state.currentView = 'not-found';
    showViewContainer('not-found-view');
    const msgEl = document.getElementById('not-found-message');
    if (msgEl) msgEl.textContent = msg;
  }

  function showViewContainer(activeContainerId) {
    const viewContainers = [
      'home-view',
      'stage-view',
      'subject-view',
      'pdf-view',
      'about-view',
      'admin-view',
      'not-found-view'
    ];

    viewContainers.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (id === activeContainerId) {
          el.style.display = 'block';
          el.classList.add('fade-in');
        } else {
          el.style.display = 'none';
          el.classList.remove('fade-in');
        }
      }
    });
  }

  function openSearchModal(initialQuery = '') {
    const modal = document.getElementById('search-modal-backdrop');
    const input = document.getElementById('modal-search-input');
    if (modal && input) {
      modal.classList.add('open');
      input.value = initialQuery;
      input.focus();
      handleSearchInput(initialQuery);
    }
  }

  function closeSearchModal() {
    const modal = document.getElementById('search-modal-backdrop');
    if (modal) modal.classList.remove('open');
  }

  function handleSearchInput(query) {
    const resultsContainer = document.getElementById('search-results-list');
    const clearBtn = document.getElementById('clear-search-btn');
    if (!resultsContainer) return;

    if (clearBtn) {
      clearBtn.style.display = query.length > 0 ? 'inline-flex' : 'none';
    }

    if (!query || query.trim() === '') {
      resultsContainer.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
          اكتب اسم المادة، رقم المحاضرة، أو كلمات من عنوان الملف للبحث الفوري...
        </div>
      `;
      return;
    }

    const results = window.SearchEngine.search(query);

    if (results.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state" style="padding: 2rem 1rem; margin: 0;">
          <div class="empty-icon-wrap" style="width: 44px; height: 44px;"><i data-lucide="search-x" style="width: 22px; height: 22px;"></i></div>
          <h4 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.35rem;">لم يتم العثور على نتائج لـ "${query}"</h4>
          <p style="font-size: 0.8rem; color: var(--text-muted);">تحقق من صحة الكلمات أو جرب البحث باسم المرحلة أو رقم المحاضرة.</p>
        </div>
      `;
      refreshIcons();
      return;
    }

    resultsContainer.innerHTML = '';
    results.forEach(item => {
      const el = document.createElement('div');
      el.className = 'search-result-item';
      el.innerHTML = `
        <div class="search-result-meta">
          <h4 class="search-result-title">${window.SearchEngine.highlightMatches(item.title, query)}</h4>
          <div class="search-result-path">
            <span>${item.stageName}</span>
            <span>·</span>
            <span>${item.subjectName}</span>
            <span>·</span>
            <span>ملف #${item.number}</span>
          </div>
        </div>
        <button class="btn-file-read" style="padding: 0.4rem 0.85rem; font-size: 0.775rem;">
          <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
          <span>عرض</span>
        </button>
      `;

      el.addEventListener('click', () => {
        closeSearchModal();
        navigateToHash(`#file/${item.stageId}/${item.subjectId}/${item.id}`);
      });

      resultsContainer.appendChild(el);
    });

    refreshIcons();
  }

  function showToast(message, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  function showGlobalLoading(show) {
    const loader = document.getElementById('global-loading-screen');
    if (loader) loader.style.display = show ? 'flex' : 'none';
  }

  function showDataLoadError(errorMsg) {
    const errorBox = document.getElementById('global-error-screen');
    if (errorBox) {
      errorBox.style.display = 'flex';
      const detail = errorBox.querySelector('.error-detail');
      if (detail) detail.textContent = errorMsg;
    }
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  return {
    init,
    navigateToHash,
    openSearchModal,
    closeSearchModal,
    openLoginModal,
    closeLoginModal,
    switchAuthTab,
    openEditStageModal,
    openAddSubjectModal,
    openEditSubjectModal,
    deleteSubjectConfirm,
    openAddFileModal,
    openEditFileModal,
    deleteFileConfirm,
    openAddUserModal,
    openEditUserModal,
    deleteUserConfirm,
    closeEditModal,
    showToast,
    switchAdminTab,
    downloadFullProjectZip,
    copyGitCommands,
    openGitHubRepoDataFolder,
    copyJsonToClipboard,
    handleTestGitHubConnection
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
