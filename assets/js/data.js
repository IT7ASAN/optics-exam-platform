/**
 * Optics Common Exam Platform - Data Layer & Admin Engine
 * مزامنة البيانات المشتركة بين الخادم وجميع المستخدمين والأجهزة عبر API مع دعم التخزين المحلي والاحتياطي
 */

const DataLayer = (() => {
  const STORAGE_KEY = 'optics_custom_exams_data';
  const LAST_SNAPSHOT_KEY = 'optics_last_complete_snapshot';
  const AUTH_KEY = 'optics_auth_session';
  const USERS_KEY = 'optics_registered_users';
  const GITHUB_CONFIG_KEY = 'optics_github_sync_config';
  const CLOUD_SYNC_KEY = 'optics_cloud_sync_config';
  // Set this to the live Node.js API origin after the backend has actually been deployed.
  // GitHub Pages is static; the previous Render hostname currently returns no-server/404.
  const DEPLOYED_API_BASE = '';

  const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
  const AUTH_EMAIL_DOMAIN = SUPABASE_CONFIG.authEmailDomain || 'optics.local';
  const LECTURES_BUCKET = 'lectures';
  let supabaseClient = null;

  function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey || !window.supabase?.createClient) return null;
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'optics_supabase_auth' }
    });
    return supabaseClient;
  }

  function isSupabaseEnabled() {
    return Boolean(getSupabase());
  }

  function usernameToEmail(username) {
    return `${username}@${AUTH_EMAIL_DOMAIN}`;
  }

  function translateSupabaseError(error) {
    const message = (error && (error.message || error.error_description || error.error)) || String(error || '');
    if (/invalid login credentials/i.test(message)) return 'اسم المستخدم أو رمز المرور غير صحيح!';
    if (/already.*(registered|exists)|duplicate key/i.test(message)) return 'اسم المستخدم مسجل مسبقاً.';
    if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'رمز المرور قصير جداً (6 أحرف على الأقل).';
    if (/rate limit|too many/i.test(message)) return 'محاولات كثيرة، يرجى الانتظار قليلاً ثم إعادة المحاولة.';
    if (/not authorized|permission denied|row-level security|42501/i.test(message)) return 'لا تملك صلاحية تنفيذ هذه العملية. سجّل الدخول بحساب المشرف.';
    return message || 'حدث خطأ غير متوقع.';
  }

  function notifyError(message) {
    console.error(message);
    if (window.App?.showToast) window.App.showToast(message, 6000);
    else alert(message);
  }

  function profileToUser(profile) {
    return {
      id: profile.id,
      username: profile.username,
      fullName: profile.full_name,
      stage: profile.stage,
      role: profile.role,
      createdAt: profile.created_at ? new Date(profile.created_at).toLocaleDateString('ar-EG') : '-'
    };
  }

  function sessionFromProfile(profile) {
    const isAdmin = profile.role === 'admin';
    return {
      isLoggedIn: true,
      role: isAdmin ? 'admin' : 'student',
      userId: profile.id,
      username: profile.username,
      displayName: isAdmin ? `مدير المنصة (${profile.username})` : (profile.full_name || profile.username),
      stage: profile.stage,
      loginTime: new Date().toISOString()
    };
  }

  async function fetchOwnProfile(userId) {
    const { data, error } = await getSupabase().from('profiles').select('*').eq('id', userId).single();
    if (error) throw error;
    return data;
  }

  // مزامنة حالة الدخول المحلية مع جلسة Supabase (انتهاء الجلسة، تغيير الصلاحيات...)
  async function syncSupabaseSession() {
    const sb = getSupabase();
    if (!sb) return;
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        localStorage.removeItem(AUTH_KEY);
        return;
      }
      const profile = await fetchOwnProfile(session.user.id);
      localStorage.setItem(AUTH_KEY, JSON.stringify(sessionFromProfile(profile)));
    } catch (e) {
      console.warn('تعذر مزامنة جلسة Supabase:', e);
    }
  }

  function decodeBase64Pdf(base64Data) {
    const raw = base64Data.includes('base64,') ? base64Data.slice(base64Data.indexOf('base64,') + 7) : base64Data;
    const binary = atob(raw.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function safeStorageSegment(value, fallback) {
    const clean = String(value || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return clean.slice(0, 60) || fallback;
  }

  function isGitHubPages() {
    return window.location.hostname.endsWith('.github.io');
  }

  function isBackendConfigured() {
    if (isSupabaseEnabled()) return false;
    return !isGitHubPages() || Boolean(DEPLOYED_API_BASE);
  }

  function apiUrl(path) {
    const base = isGitHubPages() ? DEPLOYED_API_BASE : '';
    return `${base}${path}`;
  }

  function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
  }

  // بيانات حساب المشرف الافتراضية
  const ADMIN_CREDENTIALS = {
    username: 'it7asan',
    role: 'admin',
    displayName: 'مدير المنصة (it7asan)'
  };

  function getAdminHeaders() {
    const adminPassword = sessionStorage.getItem('optics_admin_api_password');
    return adminPassword ? { 'X-Admin-Password': adminPassword } : {};
  }

  let examData = null;
  let isLoaded = false;
  let loadPromise = null;
  let isServerAvailable = false;
  let usersServerAvailable = false;
  let usersApiError = '';
  let apiRetryAfter = 0;

  function sanitizeLegacyStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && (raw.includes('data:application/pdf;base64,') || raw.length > 500000)) {
        console.warn('تطهير الذاكرة المحلية القديمة لتسريع تشغيل المنصة 🚀');
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LAST_SNAPSHOT_KEY);
      }
    } catch (e) {}
  }

  /**
   * جلب وتحميل بيانات الامتحانات (مع منع الكاش ودعم المزامنة السحابية)
   */
  async function loadData(forceRefresh = false) {
    if (isLoaded && examData && !forceRefresh) {
      return examData;
    }
    if (loadPromise && !forceRefresh) {
      return loadPromise;
    }

    sanitizeLegacyStorage();

    loadPromise = (async () => {
      try {
        let fetchedData = null;
        const cacheBuster = `?t=${Date.now()}`;

        // 0. قاعدة بيانات Supabase (المصدر الرئيسي لكل البيانات)
        if (isSupabaseEnabled()) {
          const sessionSync = syncSupabaseSession();
          try {
            const { data, error } = await getSupabase().rpc('get_platform_data');
            if (error) throw error;
            if (data && Array.isArray(data.stages) && data.stages.length > 0) {
              fetchedData = data;
              isServerAvailable = true;
            }
          } catch (sbErr) {
            isServerAvailable = false;
            console.warn('تعذر جلب البيانات من Supabase:', sbErr);
          }
          await sessionSync;
        }

        // 1. فحص الخادم المشترك (Server API) إذا كان متاحاً بمهلة فائقة السرعة (1200ms)
        if (!fetchedData && isBackendConfigured() && Date.now() >= apiRetryAfter) {
          try {
            const apiRes = await fetchWithTimeout(apiUrl(`/api/exams${cacheBuster}`), {
              cache: 'no-store',
              headers: { 'Accept': 'application/json' }
            }, 1200);
            if (apiRes.ok) {
              fetchedData = await apiRes.json();
              isServerAvailable = true;
              apiRetryAfter = 0;
            } else {
              isServerAvailable = false;
              if (apiRes.status === 404 || apiRes.status === 405) apiRetryAfter = Date.now() + 120000;
            }
          } catch (apiErr) {
            isServerAvailable = false;
            apiRetryAfter = Date.now() + 120000;
          }
        } else {
          isServerAvailable = false;
        }

        // 2. فحص المزامنة السحابية الخارجية إن تم تفعيلها (Cloud Sync Endpoint)
        if (!fetchedData) {
          const cloudConfig = getCloudSyncConfig();
          if (cloudConfig && cloudConfig.syncUrl) {
            try {
              const cloudRes = await fetchWithTimeout(
                cloudConfig.syncUrl + (cloudConfig.syncUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`,
                {
                  cache: 'no-store',
                  headers: cloudConfig.apiKey ? { 'X-Master-Key': cloudConfig.apiKey } : {}
                },
                4000
              );
              if (cloudRes.ok) {
                const cloudJson = await cloudRes.json();
                fetchedData = cloudJson.record || cloudJson;
              }
            } catch (cloudErr) {
              console.warn('تعذر الجلب من السحابة المخصصة:', cloudErr);
            }
          }
        }

        // 3. جلب ملف البيانات من المستودع (GitHub Pages / Static Hosting) - سريع جداً (9.2 KB)
        if (!fetchedData) {
          const basePath = window.location.pathname.replace(/\/[^/]*$/, '/');
          const candidatePaths = [
            `./data/exams.json${cacheBuster}`,
            `data/exams.json${cacheBuster}`,
            `${basePath}data/exams.json${cacheBuster}`
          ];
          for (const cPath of candidatePaths) {
            try {
              const fileRes = await fetchWithTimeout(cPath, {
                headers: { 'Accept': 'application/json' }
              }, 3500);
              if (fileRes.ok) {
                fetchedData = await fileRes.json();
                break;
              }
            } catch (fileErr) {
              // تجربة المسار التالي
            }
          }
        }

        // 4. إذا كنا في متصفح الأدمن نفسه مع عدم توفر سيرفر، نفحص التخزين المحلي النظيف
        const localCustom = localStorage.getItem(STORAGE_KEY);
        const lastSnapshot = localStorage.getItem(LAST_SNAPSHOT_KEY);

        if (localCustom && !isServerAvailable) {
          try {
            const parsed = JSON.parse(localCustom);
            validateData(parsed);
            const isPayloadClean = JSON.stringify(parsed).length < 200000;
            if (isPayloadClean && (!fetchedData || (parsed.lastUpdatedTimestamp && parsed.lastUpdatedTimestamp > (fetchedData.lastUpdatedTimestamp || 0)))) {
              fetchedData = parsed;
            }
          } catch (e) {}
        }

        if (!fetchedData && lastSnapshot) {
          try {
            const parsed = JSON.parse(lastSnapshot);
            validateData(parsed);
            fetchedData = parsed;
          } catch (e) {}
        }

        if (!fetchedData) {
          // بديل أمان فوري لضمان عدم توقف المنصة نهائياً
          fetchedData = {
            platformName: "منصة الامتحان المشترك",
            department: "قسم تقنيات البصريات",
            faculty: "كلية التقنيات الصحية والطبية",
            academicYear: "2026 - 2027",
            lastUpdated: "١١ أكتوبر ٢٠٢٦",
            description: "المنصة الرسمية المعتمدة لطلبة قسم تقنيات البصريات للوصول المباشر إلى جميع محاضرات وملفات الامتحان التقويمي المشترك.",
            stages: [
              { id: "stage-2", number: 2, name: "المرحلة الثانية", subtitle: "الأساسيات البصرية والتشريح العيني", description: "مواد الامتحان المشترك للمرحلة الثانية", badge: "السنة الثانية", icon: "eye", accentColor: "#7c3aed", subjects: [] },
              { id: "stage-3", number: 3, name: "المرحلة الثالثة", subtitle: "العدسات اللاصقة وفحص البصر السريري", description: "مواد الامتحان المشترك للمرحلة الثالثة", badge: "السنة الثالثة", icon: "glasses", accentColor: "#8b5cf6", subjects: [] },
              { id: "stage-4", number: 4, name: "المرحلة الرابعة", subtitle: "أمراض العين المتقدمة وتأهيل البصر", description: "مواد الامتحان المشترك للمرحلة الرابعة", badge: "السنة الرابعة", icon: "award", accentColor: "#a855f7", subjects: [] }
            ]
          };
        }

        validateData(fetchedData);
        ensureDefaultUIFields(fetchedData);
        examData = fetchedData;
        isLoaded = true;

        // حفظ نسخة محلية احتياطية
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(examData));
        } catch (e) {}

        return examData;
      } catch (error) {
        console.error('Data Loading Error:', error);
        throw error;
      } finally {
        loadPromise = null;
      }
    })();

    return loadPromise;
  }

  function ensureDefaultUIFields(data) {
    normalizeDepartmentName(data);
    if (!data.heroCardHeading) data.heroCardHeading = 'قسم تقنيات البصريات';
    if (!data.heroCardText) data.heroCardText = 'الملفات المعتمدة وزارياً للامتحان المشترك، مصنفة بدقة حسب المراحل الأكاديمية.';
    if (!Array.isArray(data.heroCardTags)) {
      data.heroCardTags = ['البصريات الهندسية', 'فحص الانكسار', 'العدسات اللاصقة', 'أمراض العين'];
    }
    if (!data.heroKicker) data.heroKicker = 'الامتحان التقويمي الوزاري الموحد';
    if (!data.heroTitle) data.heroTitle = 'كل ملفات الامتحان المشترك، في مكان واحد.';
    if (!data.heroSubtitle) {
      data.heroSubtitle = 'تصفح المحاضرات والمقررات الرسمية لقسم تقنيات البصريات، واقرأ ملفات PDF مباشرة وسلاسة عبر الهاتف والكمبيوتر دون الحاجة لتطبيقات إضافية.';
    }
    if (!data.infoBannerTitle) data.infoBannerTitle = 'ضوابط وتعليمات الامتحان المشترك';
    if (!data.infoBannerSubtitle) data.infoBannerSubtitle = 'نظام الامتحان التقويمي الصادر من وزارة التعليم العالي والبحث العلمي';
    if (!data.infoBannerText) {
      data.infoBannerText = 'الامتحان المشترك لقسم تقنيات البصريات يشمل مادتين تخصصيتين في كل مرحلة دراسية (المرحلة الثانية، الثالثة، والرابعة). يتم تحديث المواد والملفات سنوياً عبر لوحة الإدارة وملف البيانات المركزي للمنصة، بما يضمن توافق المفردات الوزارية مع الكليات والأقسام المناظرة.';
    }
    if (!data.aboutTitle) data.aboutTitle = 'منصة الامتحان المشترك – قسم تقنيات البصريات';
    if (!data.aboutSubtitle) data.aboutSubtitle = 'Optics Common Exam Platform · للعام الدراسي 2026 - 2027';
    if (!data.aboutBody) {
      data.aboutBody = 'تم تطوير هذه المنصة لتكون المرجع الرسمي والأول لطلبة قسم تقنيات البصريات للوصول الفوري والمنظم إلى جميع ملفات الامتحان التقويمي الوزاري المشترك. تم تصميم الواجهة بمعايير تطبيقات Apple الراقية بالثيم البنفسجي، لتعمل بكفاءة مطلقة على أجهزة iPhone، iPad، Mac، وشاشات الكمبيوتر.';
    }
    if (data.showPlatformFeatures === undefined) data.showPlatformFeatures = true;
    if (!Array.isArray(data.platformFeatures) || data.platformFeatures.length === 0) {
      data.platformFeatures = [
        { title: 'قارئ PDF داخلي مدمج', description: 'تصفح وقراءة المحاضرات مباشرة داخل المنصة دون الحاجة لمغادرة الموقع أو تحميل تطبيقات إضافية.', icon: 'eye', enabled: true },
        { title: 'محرك بحث ذكي وسريع', description: 'بحث فوري بالعربية مع معالجة حركات التشكيل واختصارات لوحة المفاتيح (Cmd+K) للوصول المباشر لأي ملف.', icon: 'search', enabled: true },
        { title: 'تحكم إداري كامل وشامل', description: 'صلاحيات متكاملة للمشرف لتعديل نصوص الصفحة الرئيسية، البطاقات، والمواد ورفع الملفات من الجهاز.', icon: 'shield-check', enabled: true },
        { title: 'نظام حسابات الطلاب', description: 'تسجيل حسابات شخصية للطلبة مع إمكانية تحكم المشرف في اليوزر نيم ورموز المرور وإدارتها بكل سهولة.', icon: 'users', enabled: true },
        { title: 'تصميم مخصص للهواتف والتمرير السلس', description: 'شريط سفلي iOS وتمرير سلس فائق النعومة بين أقسام الصفحة مع توافق تام مع شاشات iPhone الحديثة.', icon: 'smartphone', enabled: true },
        { title: 'تصدير JSON متوافق مع GitHub Pages', description: 'إمكانية تصدير التعديلات كملف exams.json بضغطة زر واحدة لرفعها وتحديث مستودع GitHub فوراً.', icon: 'download-cloud', enabled: true }
      ];
    }
  }

  function normalizeDepartmentName(value) {
    if (Array.isArray(value)) {
      value.forEach(normalizeDepartmentName);
      return;
    }
    if (!value || typeof value !== 'object') return;

    Object.keys(value).forEach(key => {
      const item = value[key];
      if (typeof item === 'string') {
        value[key] = item
          .replace(/قسم\s+هندسة\s+وتكنولوجيا\s+البصريات/g, 'قسم تقنيات البصريات')
          .replace(/هندسة\s+وتكنولوجيا\s+البصريات/g, 'تقنيات البصريات')
          .replace(/قسم\s+البصريات/g, 'قسم تقنيات البصريات');
      } else if (item && typeof item === 'object') {
        normalizeDepartmentName(item);
      }
    });
  }

  function validateData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('ملف البيانات غير صالح أو فارغ.');
    }
    if (!Array.isArray(data.stages)) {
      throw new Error('قائمة المراحل الدراسية غير موجودة في ملف البيانات.');
    }
  }

  function getData() {
    return examData;
  }

  /**
   * حفظ التعديلات وتحديث الطوابع الزمنية وإرسالها للسيرفر أو السحابة
   */
  async function saveChanges() {
    if (!examData) return { success: false };

    examData.lastUpdated = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    examData.lastUpdatedTimestamp = Date.now();

    // 1. حفظ نسخة في المتصفح المحلي
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(examData, null, 2));
      localStorage.setItem(LAST_SNAPSHOT_KEY, JSON.stringify(examData, null, 2));
    } catch (e) {}

    let isServerSaved = false;
    let isCloudSaved = false;

    if (isSupabaseEnabled()) {
      const { error } = await getSupabase().rpc('save_platform_data', { payload: examData });
      if (error) {
        notifyError(`فشل الحفظ في قاعدة البيانات: ${translateSupabaseError(error)}`);
        return { success: false, isServerSaved: false, isServerAvailable: true, needsGitHubCommit: false };
      }
      isServerAvailable = true;
      return { success: true, isServerSaved: true, isCloudSaved: false, isServerAvailable: true, needsGitHubCommit: false };
    }

    // 2. إرسال التحديث إلى الخادم المشترك إن وجد (Node.js API)
    if (isBackendConfigured()) {
      try {
        const res = await fetch(apiUrl('/api/exams'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(examData)
        });
        if (res.ok) {
          isServerSaved = true;
          isServerAvailable = true;
        }
      } catch (err) {
        isServerAvailable = false;
      }
    }

    // 3. إرسال إلى السحابة المخصصة إن كانت مفعلة (Custom Cloud Sync)
    const cloudConfig = getCloudSyncConfig();
    if (cloudConfig && cloudConfig.syncUrl) {
      try {
        const cloudRes = await fetch(cloudConfig.syncUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(cloudConfig.apiKey ? { 'X-Master-Key': cloudConfig.apiKey } : {})
          },
          body: JSON.stringify(examData)
        });
        if (cloudRes.ok) isCloudSaved = true;
      } catch (e) {}
    }

    return {
      success: true,
      isServerSaved,
      isCloudSaved,
      isServerAvailable,
      needsGitHubCommit: !isServerSaved && !isCloudSaved
    };
  }

  /**
   * فحص حالة الخادم المباشر لمعرفة إن كان الموقع يعمل بـ Fullstack أم GitHub Pages Static
   */
  async function checkServerStatus() {
    if (isSupabaseEnabled()) {
      const { error } = await getSupabase().rpc('get_platform_data');
      return { isOnline: !error, hasServer: !error, provider: 'supabase' };
    }
    if (!isBackendConfigured()) return { isOnline: false, hasServer: false };
    if (Date.now() < apiRetryAfter) return { isOnline: false, hasServer: false };
    try {
      const res = await fetch(apiUrl(`/api/status?_t=${Date.now()}`), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        isServerAvailable = !!data.hasServer;
        apiRetryAfter = 0;
        return { isOnline: true, hasServer: true };
      }
      if (res.status === 404 || res.status === 405) apiRetryAfter = Date.now() + 60000;
    } catch (e) {
      isServerAvailable = false;
      apiRetryAfter = Date.now() + 60000;
    }
    return { isOnline: false, hasServer: false };
  }

  /**
   * جلب وحفظ إعدادات الربط المباشر مع GitHub
   */
  function getGitHubConfig() {
    try {
      const saved = localStorage.getItem(GITHUB_CONFIG_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { repo: '', token: '', branch: 'main' };
  }

  function saveGitHubConfig(cfg) {
    try {
      localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  /**
   * جلب وحفظ إعدادات المزامنة السحابية المباشرة (Cloud Sync)
   */
  function getCloudSyncConfig() {
    try {
      const saved = localStorage.getItem(CLOUD_SYNC_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { syncUrl: '', apiKey: '' };
  }

  function saveCloudSyncConfig(cfg) {
    try {
      localStorage.setItem(CLOUD_SYNC_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  /**
   * نشر وتحديث ملف data/exams.json مباشرة على مستودع GitHub بنقرة زر واحدة
   * لتظهر التعديلات لجميع الطلاب في العالم خلال 30 ثانية
   */
  async function publishToGitHub({ repo, token, branch = 'main', commitMessage }) {
    if (!examData) {
      throw new Error('لا توجد بيانات متاحة للنشر.');
    }
    if (!repo || !token) {
      throw new Error('يرجى تحديد اسم المستودع (مثل: username/repo) ورمز الوصول الشخصي (GitHub Token).');
    }

    // تنظيف اسم المستودع
    let cleanRepo = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const cleanBranch = (branch || 'main').trim();
    const cleanToken = token.trim();

    if (!cleanRepo.includes('/')) {
      throw new Error('اسم المستودع يجب أن يكون بصيغة: اسم-المستخدم/اسم-المستودع (مثال: IT7ASAN/optics-exam-platform)');
    }

    // 1. محاولة النشر عبر السيرفر الوسيط إذا كان السيرفر متاحاً ومُهيأً
    if (isBackendConfigured()) {
      try {
        const publishResponse = await fetch(apiUrl('/api/github/publish-exams'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
          body: JSON.stringify({
            repo: cleanRepo,
            token: cleanToken,
            branch: cleanBranch,
            commitMessage: commitMessage || `تحديث بيانات منصة الامتحان المشترك بواسطة لوحة الإدارة (${new Date().toLocaleDateString('ar-EG')}) 🚀`,
            content: examData
          })
        });
        if (publishResponse.ok) {
          const publishResult = await publishResponse.json().catch(() => ({}));
          saveGitHubConfig({ repo: cleanRepo, token: cleanToken, branch: cleanBranch });
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(examData, null, 2));
            localStorage.setItem(LAST_SNAPSHOT_KEY, JSON.stringify(examData, null, 2));
          } catch (e) {}
          return {
            success: true,
            commitUrl: publishResult.commitUrl || `https://github.com/${cleanRepo}/commit/${publishResult.commitSha || ''}`,
            repoUrl: `https://github.com/${cleanRepo}`,
            branch: cleanBranch,
            date: new Date().toLocaleTimeString('ar-EG')
          };
        }
      } catch (e) {
        // الانتقال للنشر المباشر عبر واجهة برمجة GitHub
      }
    }

    // 2. النشر المباشر عبر GitHub REST API من المتصفح (يعمل 100% على GitHub Pages وبدون خادم Node.js)
    // أ) إذا تم رفع أي ملفات PDF جديدة كـ Base64، نرفعها مباشرة كملفات مستقلة في المستودع
    for (const stage of examData.stages || []) {
      for (const subject of stage.subjects || []) {
        for (const file of subject.files || []) {
          if (file.isLocalUploaded && typeof file.path === 'string' && file.path.startsWith('data:application/pdf;base64,')) {
            try {
              const base64Data = file.path.slice(file.path.indexOf('base64,') + 7).replace(/\s/g, '');
              const relativePath = `files/uploads/${stage.id}/${subject.id}/${file.id}.pdf`;
              const pdfApiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${relativePath}?ref=${encodeURIComponent(cleanBranch)}`;

              let pdfSha = null;
              try {
                const getPdf = await fetch(pdfApiUrl, {
                  headers: { 'Authorization': `token ${cleanToken}`, 'Accept': 'application/vnd.github.v3+json' }
                });
                if (getPdf.ok) {
                  const pdfInfo = await getPdf.json();
                  pdfSha = pdfInfo.sha;
                }
              } catch (e) {}

              const putPdfRes = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/${relativePath}`, {
                method: 'PUT',
                headers: {
                  'Authorization': `token ${cleanToken}`,
                  'Content-Type': 'application/json',
                  'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify({
                  message: `Upload lecture PDF: ${file.title || file.id} 📄`,
                  content: base64Data,
                  branch: cleanBranch,
                  ...(pdfSha ? { sha: pdfSha } : {})
                })
              });

              if (putPdfRes.ok) {
                file.path = `./${relativePath}`;
                file.isLocalUploaded = false;
                delete file.base64Data;
              }
            } catch (errUpload) {
              console.warn('تنبيه أثناء رفع ملف الـ PDF إلى GitHub:', errUpload);
            }
          }
        }
      }
    }

    // ب) جلب الـ SHA الحالي لملف data/exams.json
    const filePath = 'data/exams.json';
    const contentsApiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${filePath}?ref=${encodeURIComponent(cleanBranch)}`;

    let currentSha = null;
    try {
      const getRes = await fetch(contentsApiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `token ${cleanToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (getRes.ok) {
        const fileInfo = await getRes.json();
        currentSha = fileInfo.sha;
      } else if (getRes.status === 401 || getRes.status === 403) {
        throw new Error('رمز الوصول (GitHub Token) غير صالح أو منتهي الصلاحية، أو لا يملك صلاحية repo.');
      } else if (getRes.status === 404) {
        currentSha = null;
      }
    } catch (err) {
      if (err.message && err.message.includes('Token')) throw err;
    }

    // تحديث الطوابع الزمنية في examData
    examData.lastUpdated = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    examData.lastUpdatedTimestamp = Date.now();

    // تشفير نصوص الـ JSON بالعربية بدقة إلى UTF-8 Base64
    const jsonString = JSON.stringify(examData, null, 2);
    const utf8Bytes = new TextEncoder().encode(jsonString);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64Content = window.btoa(binary);

    // إرسال الـ Commit إلى مستودع GitHub
    const putUrl = `https://api.github.com/repos/${cleanRepo}/contents/${filePath}`;
    const payload = {
      message: commitMessage || `تحديث بيانات منصة الامتحان المشترك بواسطة لوحة الإدارة (${new Date().toLocaleDateString('ar-EG')}) 🚀`,
      content: base64Content,
      branch: cleanBranch
    };
    if (currentSha) {
      payload.sha = currentSha;
    }

    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${cleanToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(payload)
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      let msg = errData.message || `خطأ رقم ${putRes.status}`;
      if (putRes.status === 404) {
        msg = 'المستودع غير موجود أو لا تملك صلاحية الوصول إليه. تأكد من كتابة اسم المستودع (مثال: IT7ASAN/optics-exam-platform).';
      } else if (putRes.status === 409) {
        msg = 'تعارض في المستودع (Conflict)، يرجى إعادة المحاولة.';
      }
      throw new Error(`فشل النشر إلى GitHub: ${msg}`);
    }

    const resData = await putRes.json();
    saveGitHubConfig({ repo: cleanRepo, token: cleanToken, branch: cleanBranch });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(examData, null, 2));
      localStorage.setItem(LAST_SNAPSHOT_KEY, JSON.stringify(examData, null, 2));
    } catch (e) {}

    return {
      success: true,
      commitUrl: resData.commit?.html_url || `https://github.com/${cleanRepo}/commit/${resData.commit?.sha}`,
      repoUrl: `https://github.com/${cleanRepo}`,
      branch: cleanBranch,
      date: new Date().toLocaleTimeString('ar-EG')
    };
  }

  /**
   * فحص واختبار صحة الاتصال بمستودع GitHub وصلاحية رمز الوصول (Token)
   */
  async function testGitHubConnection({ repo, token, branch = 'main' }) {
    if (!repo || !token) {
      throw new Error('يرجى إدخال اسم المستودع ورمز الوصول (GitHub Token).');
    }
    let cleanRepo = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const cleanBranch = (branch || 'main').trim();
    const cleanToken = token.trim();

    if (!cleanRepo.includes('/')) {
      throw new Error('اسم المستودع يجب أن يكون بصيغة: اسم-المستخدم/اسم-المستودع (مثال: IT7ASAN/optics-exam-platform)');
    }

    const repoRes = await fetch(`https://api.github.com/repos/${cleanRepo}`, {
      headers: {
        'Authorization': `token ${cleanToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!repoRes.ok) {
      if (repoRes.status === 401) throw new Error('رمز الوصول (GitHub Token) غير صالح أو منتهي الصلاحية.');
      if (repoRes.status === 404) throw new Error('المستودع غير موجود على GitHub أو أن التوكن لا يملك صلاحية الوصول إليه.');
      throw new Error(`خطأ في الاتصال بالمستودع (${repoRes.status}). تأكد من صحة الـ Token.`);
    }

    const repoInfo = await repoRes.json();

    let branchExists = false;
    try {
      const branchRes = await fetch(`https://api.github.com/repos/${cleanRepo}/branches/${cleanBranch}`, {
        headers: {
          'Authorization': `token ${cleanToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      branchExists = branchRes.ok;
    } catch (e) {}

    return {
      success: true,
      repoFullName: repoInfo.full_name,
      isPrivate: repoInfo.private,
      branchExists,
      branchName: cleanBranch,
      defaultBranch: repoInfo.default_branch,
      stars: repoInfo.stargazers_count
    };
  }

  async function resetToDefault() {
    localStorage.removeItem(STORAGE_KEY);
    examData = null;
    isLoaded = false;
    return await loadData();
  }

  function exportDataAsJSON() {
    if (!examData) return;
    const jsonString = JSON.stringify(examData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exams.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * رفع ملف PDF إلى الخادم المشترك ليصبح متاحاً للجميع برابط عام
   */
  async function uploadPdfToServer(filename, base64Data, stageId, subjectId) {
    if (isSupabaseEnabled()) {
      const storagePath = `uploads/${safeStorageSegment(stageId, 'stage')}/${safeStorageSegment(subjectId, 'subject')}/${Date.now()}-${safeStorageSegment(filename, 'lecture')}.pdf`;
      const bucket = getSupabase().storage.from(LECTURES_BUCKET);
      const { error } = await bucket.upload(storagePath, decodeBase64Pdf(base64Data), { contentType: 'application/pdf', upsert: false });
      if (error) throw new Error(`فشل رفع ملف PDF إلى التخزين: ${translateSupabaseError(error)}`);
      return bucket.getPublicUrl(storagePath).data.publicUrl;
    }
    if (!isBackendConfigured()) {
      console.warn('رفع PDF إلى الخادم غير متاح على GitHub Pages؛ سيتم حفظ الملف محلياً فقط.');
      return base64Data;
    }
    try {
      const res = await fetch(apiUrl('/api/upload-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, base64Data, stageId, subjectId })
      });
      if (res.ok) {
        const json = await res.json();
        return json.path;
      }
    } catch (e) {
      console.warn('تعذر رفع الملف للخادم، سيتم الاحتفاظ به محلياً.', e);
    }
    return base64Data;
  }

  /**
   * تحديث جميع نصوص وعناصر الموقع الرئيسية وصفحة حول المنصة وبطاقة الهيرو
   */
  async function updateAllUIElements(settings) {
    if (!examData) return false;

    if (settings.platformName !== undefined) examData.platformName = settings.platformName.trim();
    if (settings.department !== undefined) examData.department = settings.department.trim();
    if (settings.faculty !== undefined) examData.faculty = settings.faculty.trim();
    if (settings.academicYear !== undefined) examData.academicYear = settings.academicYear.trim();
    if (settings.description !== undefined) examData.description = settings.description.trim();

    if (settings.heroKicker !== undefined) examData.heroKicker = settings.heroKicker.trim();
    if (settings.heroTitle !== undefined) examData.heroTitle = settings.heroTitle.trim();
    if (settings.heroSubtitle !== undefined) examData.heroSubtitle = settings.heroSubtitle.trim();

    if (settings.heroCardHeading !== undefined) examData.heroCardHeading = settings.heroCardHeading.trim();
    if (settings.heroCardText !== undefined) examData.heroCardText = settings.heroCardText.trim();
    if (settings.heroCardTags !== undefined) {
      if (Array.isArray(settings.heroCardTags)) {
        examData.heroCardTags = settings.heroCardTags;
      } else if (typeof settings.heroCardTags === 'string') {
        examData.heroCardTags = settings.heroCardTags.split(/[,،\n]+/).map(t => t.trim()).filter(Boolean);
      }
    }

    if (settings.infoBannerTitle !== undefined) examData.infoBannerTitle = settings.infoBannerTitle.trim();
    if (settings.infoBannerSubtitle !== undefined) examData.infoBannerSubtitle = settings.infoBannerSubtitle.trim();
    if (settings.infoBannerText !== undefined) examData.infoBannerText = settings.infoBannerText.trim();

    if (settings.aboutTitle !== undefined) examData.aboutTitle = settings.aboutTitle.trim();
    if (settings.aboutSubtitle !== undefined) examData.aboutSubtitle = settings.aboutSubtitle.trim();
    if (settings.aboutBody !== undefined) examData.aboutBody = settings.aboutBody.trim();
    if (settings.showPlatformFeatures !== undefined) examData.showPlatformFeatures = !!settings.showPlatformFeatures;
    if (settings.platformFeatures !== undefined) {
      if (Array.isArray(settings.platformFeatures)) {
        examData.platformFeatures = settings.platformFeatures.map(item => ({
          title: (item.title || 'ميزة جديدة').trim(),
          description: (item.description || '').trim(),
          icon: item.icon || 'sparkles',
          enabled: item.enabled !== false
        }));
      }
    }

    return await saveChanges();
  }

  async function updateStage(stageId, { name, subtitle, description, badge, accentColor }) {
    const stage = getStageById(stageId);
    if (!stage) return false;
    if (name) stage.name = name.trim();
    if (subtitle !== undefined) stage.subtitle = subtitle.trim();
    if (description !== undefined) stage.description = description.trim();
    if (badge !== undefined) stage.badge = badge.trim();
    if (accentColor) stage.accentColor = accentColor.trim();
    return await saveChanges();
  }

  async function addSubject(stageId, subjectData) {
    const stage = getStageById(stageId);
    if (!stage) return null;
    if (!stage.subjects) stage.subjects = [];

    const newId = `${stageId}-subject-${Date.now()}`;
    const newSubject = {
      id: newId,
      name: subjectData.name || 'مادة جديدة',
      nameEn: subjectData.nameEn || '',
      code: subjectData.code || '',
      description: subjectData.description || '',
      instructor: subjectData.instructor || 'أستاذ المادة المشترك',
      color: subjectData.color || '#7c3aed',
      icon: subjectData.icon || 'book-open',
      files: []
    };

    stage.subjects.push(newSubject);
    await saveChanges();
    return newSubject;
  }

  async function updateSubject(stageId, subjectId, subjectData) {
    const subject = getSubjectById(stageId, subjectId);
    if (!subject) return false;

    if (subjectData.name) subject.name = subjectData.name.trim();
    if (subjectData.nameEn !== undefined) subject.nameEn = subjectData.nameEn.trim();
    if (subjectData.code !== undefined) subject.code = subjectData.code.trim();
    if (subjectData.description !== undefined) subject.description = subjectData.description.trim();
    if (subjectData.instructor !== undefined) subject.instructor = subjectData.instructor.trim();
    if (subjectData.color) subject.color = subjectData.color.trim();
    if (subjectData.icon) subject.icon = subjectData.icon.trim();

    return await saveChanges();
  }

  async function deleteSubject(stageId, subjectId) {
    const stage = getStageById(stageId);
    if (!stage || !stage.subjects) return false;
    const idx = stage.subjects.findIndex(s => s.id === subjectId);
    if (idx === -1) return false;
    const [removed] = stage.subjects.splice(idx, 1);
    const saved = await saveChanges();
    if (saved) await removeStoredPdfs(removed.files);
    return saved;
  }

  async function addFile(stageId, subjectId, fileData) {
    const subject = getSubjectById(stageId, subjectId);
    if (!subject) return null;
    if (!subject.files) subject.files = [];

    let filePath = fileData.path || 'files/stage-2/subject-1/lecture-01.pdf';

    // إذا تم رفع ملف محلي من الجهاز بترميز Base64، نرفعه للخادم ليصبح متاحاً للجميع برابط رسمي
    if (fileData.base64Data) {
      try {
        filePath = await uploadPdfToServer(fileData.filename || 'lecture.pdf', fileData.base64Data, stageId, subjectId);
      } catch (e) {
        notifyError(e.message);
        return null;
      }
    }

    const newFile = {
      id: `file-${Date.now()}`,
      number: Number(fileData.number) || (subject.files.length + 1),
      title: fileData.title || `المحاضرة ${subject.files.length + 1}`,
      description: fileData.description || '',
      path: filePath,
      pages: Number(fileData.pages) || 12,
      size: fileData.size || '2.5 MB',
      date: fileData.date || new Date().toISOString().split('T')[0],
      isLocalUploaded: !!fileData.isLocalUploaded
    };

    subject.files.push(newFile);
    await saveChanges();
    return newFile;
  }

  async function updateFile(stageId, subjectId, fileId, fileData) {
    const file = getFileById(stageId, subjectId, fileId);
    if (!file) return false;

    const previousPath = file.path;
    let filePath = fileData.path || file.path;
    if (fileData.base64Data) {
      try {
        filePath = await uploadPdfToServer(fileData.filename || 'lecture.pdf', fileData.base64Data, stageId, subjectId);
      } catch (e) {
        notifyError(e.message);
        return false;
      }
    }

    if (fileData.number !== undefined) file.number = Number(fileData.number);
    if (fileData.title) file.title = fileData.title.trim();
    if (fileData.description !== undefined) file.description = fileData.description.trim();
    file.path = filePath;
    if (fileData.pages !== undefined) file.pages = Number(fileData.pages);
    if (fileData.size) file.size = fileData.size.trim();
    if (fileData.date) file.date = fileData.date.trim();
    if (fileData.isLocalUploaded !== undefined) file.isLocalUploaded = !!fileData.isLocalUploaded;

    const saved = await saveChanges();
    if (saved && previousPath !== file.path) await removeStoredPdfs([{ path: previousPath }]);
    return saved;
  }

  async function deleteFile(stageId, subjectId, fileId) {
    const subject = getSubjectById(stageId, subjectId);
    if (!subject || !subject.files) return false;
    const idx = subject.files.findIndex(f => f.id === fileId);
    if (idx === -1) return false;
    const [removed] = subject.files.splice(idx, 1);
    const saved = await saveChanges();
    if (saved) await removeStoredPdfs([removed]);
    return saved;
  }

  function storagePathFromUrl(fileUrl) {
    if (!SUPABASE_CONFIG.url || typeof fileUrl !== 'string') return null;
    const prefix = `${SUPABASE_CONFIG.url}/storage/v1/object/public/${LECTURES_BUCKET}/`;
    return fileUrl.startsWith(prefix) ? decodeURIComponent(fileUrl.slice(prefix.length)) : null;
  }

  async function removeStoredPdfs(files) {
    if (!isSupabaseEnabled()) return;
    const paths = (files || []).map(f => storagePathFromUrl(f && f.path)).filter(Boolean);
    if (!paths.length) return;
    const { error } = await getSupabase().storage.from(LECTURES_BUCKET).remove(paths);
    if (error) console.warn('تعذر حذف ملفات PDF من التخزين:', error);
  }

  /**
   * إدارة حسابات المستخدمين والطلاب (مزامنة مع الخادم أو الحفظ المحلي)
   */
  async function fetchServerUsers() {
    if (!isBackendConfigured()) {
      usersServerAvailable = false;
      usersApiError = '';
      return null;
    }
    try {
      const res = await fetch(apiUrl('/api/users'), { cache: 'no-store', headers: getAdminHeaders() });
      if (res.ok) {
        const users = await res.json();
        if (Array.isArray(users)) {
          usersServerAvailable = true;
          usersApiError = '';
          localStorage.setItem(USERS_KEY, JSON.stringify(users));
          return users;
        }
      }
      usersServerAvailable = res.status !== 404;
      const result = await res.json().catch(() => ({}));
      usersApiError = result.error || '';
    } catch (e) {
      usersServerAvailable = false;
      usersApiError = '';
    }
    return null;
  }

  function hasSharedUserServer() {
    return usersServerAvailable;
  }

  function getUsersApiError() {
    return usersApiError;
  }

  async function getRegisteredUsers(forceRefresh = true) {
    if (isSupabaseEnabled()) {
      if (!isAdminLoggedIn()) return [];
      const { data, error } = await getSupabase().from('profiles').select('*').eq('role', 'student').order('created_at', { ascending: true });
      if (error) {
        usersServerAvailable = true;
        usersApiError = translateSupabaseError(error);
        return [];
      }
      usersServerAvailable = true;
      usersApiError = '';
      return data.map(profileToUser);
    }
    if (forceRefresh && isBackendConfigured()) {
      const serverUsers = await fetchServerUsers();
      if (serverUsers) return serverUsers;
    }
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw) return [];
      const cachedUsers = JSON.parse(raw);
      if (!Array.isArray(cachedUsers)) return [];
      return cachedUsers;
    } catch (e) {
      return [];
    }
  }

  function cacheRegisteredUsers(users) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users, null, 2));
    } catch (e) {
      console.warn('Could not cache registered users locally:', e);
    }
  }

  async function registerUser({ username, password, fullName, stage }, startSession = true) {
    if (!username || !password) {
      return { success: false, message: 'يرجى إدخال اسم المستخدم ورمز المرور.' };
    }
    const cleanUser = username.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,29}$/.test(cleanUser)) {
      return { success: false, message: 'اسم المستخدم يجب أن يكون من 3 إلى 30 حرفاً، يبدأ بحرف إنجليزي، ويسمح بالأرقام والنقطة والشرطة والشرطة السفلية.' };
    }
    if (cleanUser === ADMIN_CREDENTIALS.username.toLowerCase()) {
      return { success: false, message: 'اسم المستخدم هذا محجوز مسبقاً للمشرف.' };
    }

    if (isSupabaseEnabled()) {
      return registerSupabaseUser({ username: cleanUser, password, fullName, stage }, startSession);
    }

    let newUser = null;

    // محاولة التسجيل عبر الخادم إذا كان متوفراً
    if (isBackendConfigured()) {
      try {
        const response = await fetch(apiUrl('/api/register'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password, fullName, stage })
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.user) {
          newUser = result.user;
        } else if (result.error) {
          return { success: false, message: result.error };
        }
      } catch (error) {}
    }

    // التسجيل المحلي في المتصفح (يعمل 100% على GitHub Pages)
    if (!newUser) {
      const localUsers = await getRegisteredUsers(false);
      if (localUsers.some(u => u.username.toLowerCase() === cleanUser)) {
        return { success: false, message: 'اسم المستخدم مسجل مسبقاً.' };
      }
      newUser = {
        id: 'usr_' + Date.now(),
        username: cleanUser,
        password: password,
        fullName: (fullName || cleanUser).trim(),
        stage: stage || 'المرحلة الثانية',
        createdAt: new Date().toLocaleDateString('ar-EG')
      };
      localUsers.push(newUser);
      cacheRegisteredUsers(localUsers);
    } else {
      const users = await getRegisteredUsers(false);
      users.push(newUser);
      cacheRegisteredUsers(users);
    }

    const session = {
      isLoggedIn: true,
      role: 'student',
      username: newUser.username,
      displayName: newUser.fullName,
      stage: newUser.stage,
      loginTime: new Date().toISOString()
    };
    if (startSession) localStorage.setItem(AUTH_KEY, JSON.stringify(session));

    return { success: true, user: newUser, session: startSession ? session : null };
  }

  async function invokeAdminUsers(body) {
    const { data, error } = await getSupabase().functions.invoke('admin-users', { body });
    if (error) {
      let message = error.message;
      try {
        const details = await error.context?.json();
        if (details?.error) message = details.error;
      } catch (e) {}
      return { success: false, message: translateSupabaseError(message) };
    }
    if (data?.error) return { success: false, message: data.error };
    return { success: true, ...data };
  }

  async function registerSupabaseUser({ username, password, fullName, stage }, startSession) {
    const metadata = { username, full_name: (fullName || username).trim(), stage: stage || 'المرحلة الثانية' };

    // إنشاء حساب من لوحة المشرف دون تغيير جلسة المشرف الحالية
    if (!startSession) {
      const res = await invokeAdminUsers({ action: 'create', username, password, fullName: metadata.full_name, stage: metadata.stage });
      if (!res.success) return res;
      return { success: true, user: profileToUser(res.user), session: null };
    }

    const { data, error } = await getSupabase().auth.signUp({
      email: usernameToEmail(username),
      password,
      options: { data: metadata }
    });
    if (error) return { success: false, message: translateSupabaseError(error) };
    if (!data.session) {
      return { success: false, message: 'تم إنشاء الحساب لكن يلزم تفعيل تأكيد البريد في Supabase. تواصل مع المشرف.' };
    }
    const profile = await fetchOwnProfile(data.user.id);
    const session = sessionFromProfile(profile);
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    return { success: true, user: profileToUser(profile), session };
  }

  async function loginWithSupabase(cleanUser, cleanPass) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email: usernameToEmail(cleanUser), password: cleanPass });
    if (error) return { success: false, message: translateSupabaseError(error) };
    try {
      const profile = await fetchOwnProfile(data.user.id);
      const session = sessionFromProfile(profile);
      localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      return { success: true, session, role: session.role };
    } catch (e) {
      await sb.auth.signOut();
      return { success: false, message: translateSupabaseError(e) };
    }
  }

  async function login(username, password) {
    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    if (isSupabaseEnabled()) {
      return loginWithSupabase(cleanUser, cleanPass);
    }

    // 1. تسجيل دخول المشرف (it7asan)
    if (cleanUser === ADMIN_CREDENTIALS.username) {
      let isAuthorized = false;

      // محاولة التحقق عبر السيرفر إن كان متاحاً
      if (isBackendConfigured()) {
        try {
          const adminResponse = await fetch(apiUrl('/api/admin/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: cleanUser, password: cleanPass })
          });
          if (adminResponse.ok) {
            isAuthorized = true;
          }
        } catch (error) {}
      }

      if (isAuthorized) {
        const session = {
          isLoggedIn: true,
          role: 'admin',
          username: ADMIN_CREDENTIALS.username,
          displayName: ADMIN_CREDENTIALS.displayName,
          loginTime: new Date().toISOString()
        };
        localStorage.setItem(AUTH_KEY, JSON.stringify(session));
        sessionStorage.setItem('optics_admin_api_password', cleanPass);
        return { success: true, session, role: 'admin' };
      }

      return { success: false, message: 'اسم المستخدم أو رمز مرور المشرف غير صحيح.' };
    }

    // 2. تسجيل دخول الطلاب
    let foundUser = null;

    if (isBackendConfigured()) {
      try {
        const response = await fetch(apiUrl('/api/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password: cleanPass })
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.user) {
          foundUser = result.user;
        }
      } catch (error) {}
    }

    // التحقق المحلي على GitHub Pages
    if (!foundUser) {
      const localUsers = await getRegisteredUsers(false);
      const match = localUsers.find(u => u.username.toLowerCase() === cleanUser && (u.password === cleanPass || !u.password));
      if (match) {
        foundUser = match;
      }
    }

    if (foundUser) {
      const session = {
        isLoggedIn: true,
        role: 'student',
        userId: foundUser.id,
        username: foundUser.username,
        displayName: foundUser.fullName,
        stage: foundUser.stage,
        loginTime: new Date().toISOString()
      };
      localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      return { success: true, session, role: 'student' };
    }

    return { success: false, message: 'اسم المستخدم أو رمز المرور غير صحيح!' };
  }

  function logout() {
    if (isSupabaseEnabled()) getSupabase().auth.signOut().catch(() => {});
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem('optics_admin_api_password');
    return true;
  }

  function isAdminLoggedIn() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return false;
      const session = JSON.parse(raw);
      return session && session.isLoggedIn === true && session.role === 'admin';
    } catch (e) {
      return false;
    }
  }

  function getCurrentUser() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  async function updateUser(userId, { username, password, fullName, stage }) {
    if (isSupabaseEnabled()) {
      const res = await invokeAdminUsers({ action: 'update', userId, username, password, fullName, stage });
      return res.success ? { success: true, user: profileToUser(res.user) } : res;
    }
    if (isBackendConfigured()) {
      try {
        const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(userId)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
          body: JSON.stringify({ username, password, fullName, stage })
        });
        if (response.ok) {
          const result = await response.json().catch(() => ({}));
          await getRegisteredUsers(true);
          return result.user || true;
        }
      } catch (error) {}
    }

    const users = await getRegisteredUsers(false);
    const user = users.find(u => u.id === userId);
    if (!user) return false;

    if (username) {
      const cleanUser = username.trim().toLowerCase();
      if (!/^[a-z][a-z0-9._-]{2,29}$/.test(cleanUser)) {
        return { success: false, message: 'اسم المستخدم يجب أن يكون من 3 إلى 30 حرفاً، يبدأ بحرف إنجليزي، ويسمح بالأرقام والنقطة والشرطة والشرطة السفلية.' };
      }
      const dup = users.some(u => u.id !== userId && u.username.toLowerCase() === cleanUser);
      if (dup) return { success: false, message: 'اسم المستخدم مستخدم بالفعل بحساب آخر.' };
      user.username = cleanUser;
    }
    if (password) user.password = password.trim();
    if (fullName) user.fullName = fullName.trim();
    if (stage) user.stage = stage;
    cacheRegisteredUsers(users);
    return { success: true, user };
  }

  async function deleteUser(userId) {
    if (isSupabaseEnabled()) {
      const res = await invokeAdminUsers({ action: 'delete', userId });
      if (!res.success) notifyError(res.message);
      return res.success;
    }
    if (isBackendConfigured()) {
      try {
        const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(userId)}`), {
          method: 'DELETE',
          headers: getAdminHeaders()
        });
        if (response.ok) {
          await getRegisteredUsers(true);
          return true;
        }
      } catch (error) {}
    }

    const users = await getRegisteredUsers(false);
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return false;
    users.splice(idx, 1);
    cacheRegisteredUsers(users);
    return true;
  }

  function getStageById(stageId) {
    if (!examData || !examData.stages) return null;
    return examData.stages.find(s => s.id === stageId) || null;
  }

  function getSubjectById(stageId, subjectId) {
    const stage = getStageById(stageId);
    if (!stage || !stage.subjects) return null;
    return stage.subjects.find(sub => sub.id === subjectId) || null;
  }

  function getFileById(stageId, subjectId, fileId) {
    const subject = getSubjectById(stageId, subjectId);
    if (!subject || !subject.files) return null;
    return subject.files.find(f => f.id === fileId) || null;
  }

  function getStats() {
    if (!examData || !examData.stages) {
      return { stagesCount: 0, subjectsCount: 0, filesCount: 0 };
    }

    let stagesCount = examData.stages.length;
    let subjectsCount = 0;
    let filesCount = 0;

    examData.stages.forEach(stage => {
      if (Array.isArray(stage.subjects)) {
        subjectsCount += stage.subjects.length;
        stage.subjects.forEach(subject => {
          if (Array.isArray(subject.files)) {
            filesCount += subject.files.length;
          }
        });
      }
    });

    return { stagesCount, subjectsCount, filesCount };
  }

  function getAllFilesFlat() {
    if (!examData || !examData.stages) return [];
    const flat = [];

    examData.stages.forEach(stage => {
      if (Array.isArray(stage.subjects)) {
        stage.subjects.forEach(subject => {
          if (Array.isArray(subject.files)) {
            subject.files.forEach(file => {
              flat.push({
                ...file,
                stageId: stage.id,
                stageName: stage.name,
                subjectId: subject.id,
                subjectName: subject.name,
                subjectNameEn: subject.nameEn || '',
                subjectCode: subject.code || ''
              });
            });
          }
        });
      }
    });

    return flat;
  }

  return {
    loadData,
    getData,
    saveChanges,
    resetToDefault,
    exportDataAsJSON,
    uploadPdfToServer,
    updateAllUIElements,
    updateStage,
    addSubject,
    updateSubject,
    deleteSubject,
    addFile,
    updateFile,
    deleteFile,
    getRegisteredUsers,
    hasSharedUserServer,
    getUsersApiError,
    registerUser,
    login,
    logout,
    isAdminLoggedIn,
    getCurrentUser,
    updateUser,
    deleteUser,
    getStageById,
    getSubjectById,
    getFileById,
    getStats,
    getAllFilesFlat,
    publishToGitHub,
    testGitHubConnection,
    getGitHubConfig,
    saveGitHubConfig,
    getCloudSyncConfig,
    saveCloudSyncConfig,
    checkServerStatus,
    isSupabaseEnabled
  };
})();

window.DataLayer = DataLayer;
