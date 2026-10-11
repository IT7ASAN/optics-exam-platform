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

  // بيانات حساب المشرف الافتراضية
  const ADMIN_CREDENTIALS = {
    username: 'it7asan',
    password: '20032003',
    role: 'admin',
    displayName: 'مدير المنصة (it7asan)'
  };

  const DEFAULT_USERS = [
    {
      id: 'usr-1',
      username: 'ahmed_optics',
      password: '123456user',
      fullName: 'أحمد علي حسن',
      stage: 'المرحلة الثالثة',
      role: 'student',
      createdAt: '2026-09-20'
    },
    {
      id: 'usr-2',
      username: 'zahraa_optics',
      password: '123456user',
      fullName: 'زهراء محمد كاظم',
      stage: 'المرحلة الرابعة',
      role: 'student',
      createdAt: '2026-09-25'
    }
  ];

  let examData = null;
  let isLoaded = false;
  let loadPromise = null;
  let isServerAvailable = false;

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
        try {
          const apiRes = await fetch(`/api/exams${cacheBuster}`, {
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
          }
        } catch (apiErr) {
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
    if (!data.heroCardHeading) data.heroCardHeading = 'قسم هندسة وتكنولوجيا البصريات';
    if (!data.heroCardText) data.heroCardText = 'الملفات المعتمدة وزارياً للامتحان المشترك، مصنفة بدقة حسب المراحل الأكاديمية.';
    if (!Array.isArray(data.heroCardTags)) {
      data.heroCardTags = ['البصريات الهندسية', 'فحص الانكسار', 'العدسات اللاصقة', 'أمراض العين'];
    }
    if (!data.heroKicker) data.heroKicker = 'الامتحان التقويمي الوزاري الموحد';
    if (!data.heroTitle) data.heroTitle = 'كل ملفات الامتحان المشترك، في مكان واحد.';
    if (!data.heroSubtitle) {
      data.heroSubtitle = 'تصفح المحاضرات والمقررات الرسمية لقسم هندسة وتكنولوجيا البصريات، واقرأ ملفات PDF مباشرة وسلاسة عبر الهاتف والكمبيوتر دون الحاجة لتطبيقات إضافية.';
    }
    if (!data.infoBannerTitle) data.infoBannerTitle = 'ضوابط وتعليمات الامتحان المشترك';
    if (!data.infoBannerSubtitle) data.infoBannerSubtitle = 'نظام الامتحان التقويمي الصادر من وزارة التعليم العالي والبحث العلمي';
    if (!data.infoBannerText) {
      data.infoBannerText = 'الامتحان المشترك لقسم هندسة وتكنولوجيا البصريات يشمل مادتين تخصصيتين في كل مرحلة دراسية (المرحلة الثانية، الثالثة، والرابعة). يتم تحديث المواد والملفات سنوياً عبر لوحة الإدارة وملف البيانات المركزي للمنصة، بما يضمن توافق المفردات الوزارية مع الكليات والأقسام المناظرة.';
    }
    if (!data.aboutTitle) data.aboutTitle = 'منصة الامتحان المشترك – قسم هندسة وتكنولوجيا البصريات';
    if (!data.aboutSubtitle) data.aboutSubtitle = 'Optics Common Exam Platform · للعام الدراسي 2026 - 2027';
    if (!data.aboutBody) {
      data.aboutBody = 'تم تطوير هذه المنصة لتكون المرجع الرسمي والأول لطلبة قسم هندسة وتكنولوجيا البصريات للوصول الفوري والمنظم إلى جميع ملفات الامتحان التقويمي الوزاري المشترك. تم تصميم الواجهة بمعايير تطبيقات Apple الراقية بالثيم البنفسجي، لتعمل بكفاءة مطلقة على أجهزة iPhone، iPad، Mac، وشاشات الكمبيوتر.';
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
      const res = await fetch('/api/exams', {
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
    try {
      const res = await fetch(`/api/status?_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        isServerAvailable = !!data.hasServer;
        return { isOnline: true, hasServer: true };
      }
    } catch (e) {
      isServerAvailable = false;
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

    const filePath = 'data/exams.json';
    const apiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${filePath}?ref=${encodeURIComponent(cleanBranch)}`;

    // 1. جلب الـ SHA الحالي للملف لتحديثه
    let currentSha = null;
    try {
      const getRes = await fetch(apiUrl, {
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
        throw new Error('رمز الوصول (GitHub Token) غير صالح أو منتهي الصلاحية، أو لا يملك صلاحية repo/contents.');
      } else if (getRes.status === 404) {
        currentSha = null; // سيتم إنشاء الملف لأول مرة
      }
    } catch (err) {
      if (err.message && err.message.includes('Token')) throw err;
    }

    // 2. تحديث الطوابع الزمنية في examData
    examData.lastUpdated = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    examData.lastUpdatedTimestamp = Date.now();

    // تشفير النصوص العربية بدقة إلى UTF-8 Base64
    const jsonString = JSON.stringify(examData, null, 2);
    const utf8Bytes = new TextEncoder().encode(jsonString);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64Content = window.btoa(binary);

    // 3. إرسال الـ Commit إلى GitHub REST API
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
        msg = 'المستودع غير موجود أو لا تملك صلاحية الوصول إليه. تأكد من صحة اسم المستودع.';
      } else if (putRes.status === 409) {
        msg = 'تعارض في المستودع (Conflict)، جرب إعادة المحاولة.';
      }
      throw new Error(`فشل النشر إلى GitHub: ${msg}`);
    }

    const resData = await putRes.json();

    // حفظ الإعدادات للاستخدام المستقبلي
    saveGitHubConfig({ repo: cleanRepo, token: cleanToken, branch: cleanBranch });

    // حفظ نسخة محلية كاملة وآخر نسخة محفوظة للفتح التالي
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
      throw new Error('اسم المستودع يجب أن يكون بصيغة: اسم-المستخدم/اسم-المستودع (مثال: ahmed/optics-platform)');
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
      throw new Error(`خطأ في الاتصال بالمستودع (${repoRes.status}). تأكد من إعدادات الـ Token.`);
    }

    const repoInfo = await repoRes.json();

    // فحص الفرع
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
    try {
      const res = await fetch('/api/upload-pdf', {
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
      const res = await fetch('/api/users', { cache: 'no-store' });
      if (res.ok) {
        const users = await res.json();
        if (Array.isArray(users) && users.length > 0) {
          localStorage.setItem(USERS_KEY, JSON.stringify(users));
          return users;
        }
      }
    } catch (e) {}
    return null;
  }

  function getRegisteredUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw) {
        localStorage.setItem(USERS_KEY, JSON.stringify(DEFAULT_USERS));
        fetchServerUsers();
        return [...DEFAULT_USERS];
      }
      return JSON.parse(raw);
    } catch (e) {
      return [...DEFAULT_USERS];
    }
  }

  async function saveRegisteredUsers(users) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users, null, 2));
      await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(users)
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function registerUser({ username, password, fullName, stage }) {
    if (!username || !password) {
      return { success: false, message: 'يرجى إدخال اسم المستخدم ورمز المرور.' };
    }
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser === ADMIN_CREDENTIALS.username.toLowerCase()) {
      return { success: false, message: 'اسم المستخدم هذا محجوز مسبقاً.' };
    }

    const users = getRegisteredUsers();
    const exists = users.some(u => u.username.toLowerCase() === cleanUser);
    if (exists) {
      return { success: false, message: 'اسم المستخدم مسجل بالفعل! يرجى اختيار اسم آخر.' };
    }

    const newUser = {
      id: `usr-${Date.now()}`,
      username: cleanUser,
      password: password.trim(),
      fullName: (fullName || cleanUser).trim(),
      stage: stage || 'المرحلة الثانية',
      role: 'student',
      createdAt: new Date().toISOString().split('T')[0]
    };

    users.push(newUser);
    await saveRegisteredUsers(users);

    const session = {
      isLoggedIn: true,
      role: 'student',
      username: newUser.username,
      displayName: newUser.fullName,
      stage: newUser.stage,
      loginTime: new Date().toISOString()
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));

    return { success: true, user: newUser, session };
  }

  function login(username, password) {
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (cleanUser === ADMIN_CREDENTIALS.username && cleanPass === ADMIN_CREDENTIALS.password) {
      const session = {
        isLoggedIn: true,
        role: 'admin',
        username: ADMIN_CREDENTIALS.username,
        displayName: ADMIN_CREDENTIALS.displayName,
        loginTime: new Date().toISOString()
      };
      localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      return { success: true, session, role: 'admin' };
    }

    const users = getRegisteredUsers();
    const foundUser = users.find(u => u.username.toLowerCase() === cleanUser.toLowerCase() && u.password === cleanPass);

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
    const users = getRegisteredUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return false;

    if (username) {
      const cleanUser = username.trim().toLowerCase();
      const dup = users.some(u => u.id !== userId && u.username.toLowerCase() === cleanUser);
      if (dup) return { success: false, message: 'اسم المستخدم مستخدم بالفعل بحساب آخر.' };
      user.username = cleanUser;
    }
    if (password) user.password = password.trim();
    if (fullName !== undefined) user.fullName = fullName.trim();
    if (stage !== undefined) user.stage = stage.trim();

    await saveRegisteredUsers(users);
    return { success: true, user };
  }

  async function deleteUser(userId) {
    const users = getRegisteredUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return false;
    users.splice(idx, 1);
    await saveRegisteredUsers(users);
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
