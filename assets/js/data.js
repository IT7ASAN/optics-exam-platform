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
  const DEPLOYED_API_BASE = 'https://optics-exam-platform.onrender.com';

  function apiUrl(path) {
    const isGitHubPages = window.location.hostname.endsWith('.github.io');
    const base = isGitHubPages ? DEPLOYED_API_BASE : '';
    return `${base}${path}`;
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

    loadPromise = (async () => {
      try {
        let fetchedData = null;
        const cacheBuster = `?t=${Date.now()}`;

        // 1. محاولة جلب أحدث البيانات الحية من الخادم المشترك (Server API) إذا كان متاحاً
        if (Date.now() >= apiRetryAfter) {
          try {
            const apiRes = await fetch(apiUrl(`/api/exams${cacheBuster}`), {
              cache: 'no-store',
              headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
              }
            });
            if (apiRes.ok) {
              fetchedData = await apiRes.json();
              isServerAvailable = true;
              apiRetryAfter = 0;
            } else {
              isServerAvailable = false;
              if (apiRes.status === 404 || apiRes.status === 405) apiRetryAfter = Date.now() + 60000;
            }
          } catch (apiErr) {
            isServerAvailable = false;
            apiRetryAfter = Date.now() + 60000;
          }
        } else {
          isServerAvailable = false;
        }

        // 2. فحص المزامنة السحابية الخارجية إن تم تفعيلها (Cloud Sync Endpoint)
        if (!fetchedData) {
          const cloudConfig = getCloudSyncConfig();
          if (cloudConfig && cloudConfig.syncUrl) {
            try {
              const cloudRes = await fetch(cloudConfig.syncUrl + (cloudConfig.syncUrl.includes('?') ? '&' : '?') + `_t=${Date.now()}`, {
                cache: 'no-store',
                headers: cloudConfig.apiKey ? { 'X-Master-Key': cloudConfig.apiKey } : {}
              });
              if (cloudRes.ok) {
                const cloudJson = await cloudRes.json();
                fetchedData = cloudJson.record || cloudJson;
              }
            } catch (cloudErr) {
              console.warn('تعذر الجلب من السحابة المخصصة:', cloudErr);
            }
          }
        }

        // 3. جلب ملف البيانات من المستودع (GitHub Pages / Static Hosting) مع كسر الكاش لضمان وصول التعديلات للجميع
        if (!fetchedData) {
          try {
            const fileRes = await fetch(`./data/exams.json${cacheBuster}`, {
              cache: 'no-store',
              headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
              }
            });
            if (fileRes.ok) {
              fetchedData = await fileRes.json();
            }
          } catch (fileErr) {
            console.warn('تعذر جلب ملف exams.json من المستودع:', fileErr);
          }
        }

        // 4. إذا كنا في متصفح الأدمن نفسه مع عدم توفر سيرفر، نفحص التخزين المحلي
        const localCustom = localStorage.getItem(STORAGE_KEY);
        const lastSnapshot = localStorage.getItem(LAST_SNAPSHOT_KEY);

        if (localCustom && !isServerAvailable) {
          try {
            const parsed = JSON.parse(localCustom);
            validateData(parsed);
            if (!fetchedData || (parsed.lastUpdatedTimestamp && parsed.lastUpdatedTimestamp > (fetchedData.lastUpdatedTimestamp || 0))) {
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
          throw new Error('تعذر جلب ملف البيانات من الخادم أو المستودع.');
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

    // 2. إرسال التحديث إلى الخادم المشترك إن وجد (Node.js API) ليظهر فوراً للجميع
    try {
      const res = await fetch(apiUrl('/api/exams'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(examData)
      });
      if (res.ok) {
        console.log('✅ تم إرسال وتحديث البيانات بنجاح على الخادم المشترك.');
        isServerSaved = true;
        isServerAvailable = true;
      }
    } catch (err) {
      isServerAvailable = false;
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
      throw new Error('اسم المستودع يجب أن يكون بصيغة: اسم-المستخدم/اسم-المستودع (مثال: ahmed/optics-platform)');
    }

    // تحديث الطوابع الزمنية قبل إرسال البيانات إلى الخادم الوسيط.
    examData.lastUpdated = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    examData.lastUpdatedTimestamp = Date.now();

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

    const publishResult = await publishResponse.json().catch(() => ({}));
    if (!publishResponse.ok) {
      throw new Error(`فشل النشر إلى GitHub: ${publishResult.error || `خطأ رقم ${publishResponse.status}`}`);
    }

    // حفظ الإعدادات للاستخدام المستقبلي
    saveGitHubConfig({ repo: cleanRepo, token: cleanToken, branch: cleanBranch });

    // حفظ نسخة محلية كاملة وآخر نسخة محفوظة للفتح التالي
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
      throw new Error('اسم المستودع يجب أن يكون بصيغة: اسم-المستخدم/اسم-المستودع (مثال: ahmed/optics-platform)');
    }

    try {
      const response = await fetch(apiUrl('/api/github/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify({ repo: cleanRepo, token: cleanToken, branch: cleanBranch })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `تعذر الاتصال بخادم النشر (${response.status}).`);
      return result;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('خادم النشر غير متاح. انشر خدمة Node.js على Render أولاً ثم أعد المحاولة.');
      }
      throw error;
    }
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
    stage.subjects.splice(idx, 1);
    return await saveChanges();
  }

  async function addFile(stageId, subjectId, fileData) {
    const subject = getSubjectById(stageId, subjectId);
    if (!subject) return null;
    if (!subject.files) subject.files = [];

    let filePath = fileData.path || 'files/stage-2/subject-1/lecture-01.pdf';

    // إذا تم رفع ملف محلي من الجهاز بترميز Base64، نرفعه للخادم ليصبح متاحاً للجميع برابط رسمي
    if (fileData.base64Data) {
      const serverPath = await uploadPdfToServer(fileData.filename || 'lecture.pdf', fileData.base64Data, stageId, subjectId);
      filePath = serverPath;
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

    let filePath = fileData.path || file.path;
    if (fileData.base64Data) {
      const serverPath = await uploadPdfToServer(fileData.filename || 'lecture.pdf', fileData.base64Data, stageId, subjectId);
      filePath = serverPath;
    }

    if (fileData.number !== undefined) file.number = Number(fileData.number);
    if (fileData.title) file.title = fileData.title.trim();
    if (fileData.description !== undefined) file.description = fileData.description.trim();
    file.path = filePath;
    if (fileData.pages !== undefined) file.pages = Number(fileData.pages);
    if (fileData.size) file.size = fileData.size.trim();
    if (fileData.date) file.date = fileData.date.trim();
    if (fileData.isLocalUploaded !== undefined) file.isLocalUploaded = !!fileData.isLocalUploaded;

    return await saveChanges();
  }

  async function deleteFile(stageId, subjectId, fileId) {
    const subject = getSubjectById(stageId, subjectId);
    if (!subject || !subject.files) return false;
    const idx = subject.files.findIndex(f => f.id === fileId);
    if (idx === -1) return false;
    subject.files.splice(idx, 1);
    return await saveChanges();
  }

  /**
   * إدارة حسابات المستخدمين والطلاب (مزامنة مع الخادم)
   */
  async function fetchServerUsers() {
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
      usersApiError = result.error || (usersServerAvailable ? 'تعذر جلب الحسابات من الخادم.' : 'لا يوجد خادم حسابات على هذا العنوان.');
    } catch (e) {
      usersServerAvailable = false;
      usersApiError = 'تعذر الاتصال بخادم الحسابات.';
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
    if (forceRefresh) {
      const serverUsers = await fetchServerUsers();
      if (serverUsers) return serverUsers;
    }
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw) {
        return [];
      }
      const cachedUsers = JSON.parse(raw);
      if (!Array.isArray(cachedUsers)) return [];
      cachedUsers.forEach(user => delete user.password);
      cacheRegisteredUsers(cachedUsers);
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
      return { success: false, message: 'اسم المستخدم هذا محجوز مسبقاً.' };
    }

    let response;
    try {
      response = await fetch(apiUrl('/api/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password, fullName, stage })
      });
    } catch (error) {
      return { success: false, message: 'إنشاء الحسابات المشتركة يتطلب استضافة المنصة على خادم Node.js. GitHub Pages لا يحفظ الحسابات.' };
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.user) {
      return { success: false, message: result.error || 'خادم الحسابات غير متاح. GitHub Pages لا يدعم إنشاء حسابات مشتركة؛ انشر المنصة على خادم Node.js.' };
    }

    const newUser = result.user;
    const users = await getRegisteredUsers(false);
    users.push(newUser);
    cacheRegisteredUsers(users);

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

  async function login(username, password) {
    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    if (cleanUser === ADMIN_CREDENTIALS.username) {
      let adminResponse;
      try {
        adminResponse = await fetch(apiUrl('/api/admin/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUser, password: cleanPass })
        });
      } catch (error) {
        return { success: false, message: 'تسجيل دخول المشرف وإدارة الحسابات يتطلبان خادم Node.js.' };
      }
      const adminResult = await adminResponse.json().catch(() => ({}));
      if (!adminResponse.ok) return { success: false, message: adminResult.error || 'تعذر تسجيل دخول المشرف.' };
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

    let foundUser = null;
    try {
      const response = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password: cleanPass })
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) foundUser = result.user;
      else if (result.error) return { success: false, message: result.error };
      else return { success: false, message: 'خادم الحسابات غير متاح. يلزم تشغيل المنصة على خادم Node.js لتسجيل الدخول.' };
    } catch (error) {
      return { success: false, message: 'تسجيل الدخول للحسابات المشتركة يتطلب اتصالاً بخادم المنصة.' };
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
    try {
      const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(userId)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify({ username: username || user.username, password, fullName, stage })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return { success: false, message: result.error || 'تعذر تحديث الحساب.' };
      Object.assign(user, result.user);
      cacheRegisteredUsers(users);
      return { success: true, user };
    } catch (error) {
      return { success: false, message: 'تعذر الاتصال بخادم الحسابات.' };
    }
  }

  async function deleteUser(userId) {
    const users = await getRegisteredUsers(false);
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return false;
    try {
      const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(userId)}`), {
        method: 'DELETE',
        headers: getAdminHeaders()
      });
      if (!response.ok) return false;
      users.splice(idx, 1);
      cacheRegisteredUsers(users);
      return true;
    } catch (error) {
      return false;
    }
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
    checkServerStatus
  };
})();

window.DataLayer = DataLayer;
