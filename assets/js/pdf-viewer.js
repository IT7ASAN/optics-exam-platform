/**
 * Optics Common Exam Platform - In-App PDF Viewer
 * قارئ ملفات PDF متكامل ومحسّن للهاتف والكمبيوتر مع دعم كامل للخطوط العربية ومنع تقطع الكلمات
 */

const PDFViewer = (() => {
  const PDF_DATA_PREFIX = 'data:application/pdf;base64,';
  const PDFJS_VERSION = '3.11.174';

  // روابط جداول الحروف والخطوط القياسية من CDN الرسمي لـ pdfjs-dist
  const CMAP_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/cmaps/`;
  const STANDARD_FONTS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;
  const WORKER_SRC = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

  let currentPdfDoc = null;
  let currentPageNum = 1;
  let totalNumPages = 0;
  let currentScale = 1.25;
  let isPageRendering = false;
  let pageNumPending = null;
  let currentRenderTask = null;
  let currentFilePath = '';
  let currentFileMeta = null;
  let currentObjectUrl = '';
  let currentPdfBytes = null;

  // ذاكرة مؤقتة للملفات المحملة لمنع إعادة التنزيل عند إعادة فتح المحاضرة
  const pdfBytesCache = new Map();
  const MAX_CACHED_DOCS = 6;

  function isEmbeddedPdfData(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    return filePath.startsWith('data:') || filePath.includes(';base64,');
  }

  function normalizeBase64Payload(value) {
    let payload = String(value || '');
    if (payload.includes(',')) {
      payload = payload.slice(payload.indexOf(',') + 1);
    }
    return payload.replace(/\s/g, '');
  }

  function decodeBase64ToUint8Array(base64Payload) {
    const cleanPayload = normalizeBase64Payload(base64Payload);
    const binary = atob(cleanPayload);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function resolvePdfBytes(filePath) {
    if (!filePath) {
      throw new Error('مسار الملف غير محدد.');
    }
    if (pdfBytesCache.has(filePath)) {
      return pdfBytesCache.get(filePath);
    }
    let bytes;
    if (isEmbeddedPdfData(filePath)) {
      bytes = decodeBase64ToUint8Array(filePath);
    } else {
      const response = await fetch(filePath, { cache: 'default' });
      if (!response.ok) {
        throw new Error(`تعذر تحميل ملف PDF (${response.status})`);
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (pdfBytesCache.size >= MAX_CACHED_DOCS) {
      const firstKey = pdfBytesCache.keys().next().value;
      pdfBytesCache.delete(firstKey);
    }
    pdfBytesCache.set(filePath, bytes);
    return bytes;
  }

  function bytesToObjectUrl(bytes) {
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }

  function revokeCurrentObjectUrl() {
    if (currentObjectUrl) {
      try {
        URL.revokeObjectURL(currentObjectUrl);
      } catch (e) {}
      currentObjectUrl = '';
    }
  }

  /**
   * خيارات محرك PDF.js - معالجة خطوط النصوص العربية بدقة تامة لمنع تقطع الحروف
   */
  function getPdfJsDocumentOptions(source) {
    return {
      ...source,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONTS_URL,
      // رسم الحروف كمسارات من خط المستند نفسه بدل @font-face: يمنع تقطع الكلمات العربية في ملفات Word
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false
    };
  }

  // DOM Elements
  let containerEl = null;
  let canvasEl = null;
  let ctx = null;
  let pageNumSpan = null;
  let pageCountSpan = null;
  let loadingEl = null;
  let errorEl = null;
  let titleEl = null;
  let subtitleEl = null;

  /**
   * تهيئة القارئ بربط عناصر واجهة المستخدم
   */
  function init(elements) {
    containerEl = elements.container;
    canvasEl = elements.canvas;
    if (canvasEl) {
      ctx = canvasEl.getContext('2d');
    }
    pageNumSpan = elements.pageNumSpan;
    pageCountSpan = elements.pageCountSpan;
    loadingEl = elements.loadingEl;
    errorEl = elements.errorEl;
    titleEl = elements.titleEl;
    subtitleEl = elements.subtitleEl;

    // تهيئة عمال PDF.js إن توفرت والتحميل المسبق في الخلفية
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      try {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => {
            fetch(WORKER_SRC, { mode: 'no-cors' }).catch(() => {});
          });
        }
      } catch (e) {}
    }

    // دعم إيماءات اللمس للهاتف (Swipe للتنقل بين الصفحات)
    setupTouchGestures();
  }

  /**
   * تحميل وعرض ملف PDF
   */
  async function loadDocument(filePath, meta) {
    currentFilePath = filePath;
    currentFileMeta = meta || {};
    currentPageNum = 1;
    revokeCurrentObjectUrl();
    currentPdfBytes = null;

    // تحديث العناوين
    if (titleEl) titleEl.textContent = meta.title || 'ملف المحاضرة';
    if (subtitleEl) subtitleEl.textContent = `${meta.stageName || ''} · ${meta.subjectName || ''}`;

    showLoading(true);
    showError(false);

    // التحقق من توفر مكتبة PDF.js
    if (!window.pdfjsLib) {
      console.warn('مكتبة PDF.js غير متوفرة، سيتم التحويل إلى وضع العارض البديل.');
      renderFallbackViewer(filePath);
      return;
    }

    try {
      if (currentRenderTask) {
        try {
          currentRenderTask.cancel();
        } catch (e) {}
        currentRenderTask = null;
      }

      if (currentPdfDoc) {
        currentPdfDoc.destroy();
        currentPdfDoc = null;
      }

      // الملفات البعيدة تُقرأ تدريجياً لتظهر الصفحة الأولى قبل اكتمال التنزيل
      let source;
      if (pdfBytesCache.has(filePath) || isEmbeddedPdfData(filePath)) {
        currentPdfBytes = await resolvePdfBytes(filePath);
        source = { data: currentPdfBytes.slice() };
      } else {
        source = { url: filePath, rangeChunkSize: 262144 };
      }

      const loadingTask = window.pdfjsLib.getDocument(getPdfJsDocumentOptions(source));

      currentPdfDoc = await loadingTask.promise;
      totalNumPages = currentPdfDoc.numPages;

      if (pageCountSpan) pageCountSpan.textContent = totalNumPages;

      // ضبط التكبير الذاتي حسب حجم الشاشة
      autoScaleForViewport();

      // عرض الصفحة الأولى
      renderPage(currentPageNum);
    } catch (err) {
      console.error('فشل تحميل ملف PDF:', err);
      showLoading(false);
      renderFallbackViewer(filePath, err.message);
    }
  }

  /**
   * رسم صفحة محددة على عنصر Canvas بأعلى دقة وضوح
   */
  async function renderPage(num) {
    if (!currentPdfDoc || !canvasEl) return;

    if (currentRenderTask) {
      try {
        currentRenderTask.cancel();
      } catch (e) {}
      currentRenderTask = null;
    }

    isPageRendering = true;
    showLoading(true);

    try {
      const page = await currentPdfDoc.getPage(num);
      
      const viewport = page.getViewport({ scale: currentScale });
      // ضبط مضاعف الدقة بين 1 و 1.75 لضمان قراءة فائقة النقاء دون إبطاء الهاتف أو استهلاك الذاكرة
      const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.75);

      canvasEl.height = Math.floor(viewport.height * pixelRatio);
      canvasEl.width = Math.floor(viewport.width * pixelRatio);
      canvasEl.style.width = `${Math.floor(viewport.width)}px`;
      canvasEl.style.height = `${Math.floor(viewport.height)}px`;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const renderContext = {
        canvasContext: ctx,
        viewport,
        intent: 'display'
      };

      currentRenderTask = page.render(renderContext);
      await currentRenderTask.promise;
      currentRenderTask = null;

      isPageRendering = false;
      showLoading(false);

      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }

      // تحديث مؤشرات الأرقام
      if (pageNumSpan) pageNumSpan.textContent = num;
      updateControlStates();
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') {
        return;
      }
      console.error('خطأ أثناء عرض الصفحة:', err);
      isPageRendering = false;
      showLoading(false);
    }
  }

  /**
   * إدارة الصفحات المعلقة أثناء التصيير
   */
  function queueRenderPage(num) {
    if (isPageRendering) {
      pageNumPending = num;
    } else {
      renderPage(num);
    }
  }

  /**
   * الانتقال للصفحة السابقة
   */
  function prevPage() {
    if (currentPageNum <= 1) return;
    currentPageNum--;
    queueRenderPage(currentPageNum);
  }

  /**
   * الانتقال للصفحة التالية
   */
  function nextPage() {
    if (!currentPdfDoc || currentPageNum >= totalNumPages) return;
    currentPageNum++;
    queueRenderPage(currentPageNum);
  }

  /**
   * تكبير العرض
   */
  function zoomIn() {
    if (currentScale >= 3.0) return;
    currentScale += 0.25;
    queueRenderPage(currentPageNum);
  }

  /**
   * تصغير العرض
   */
  function zoomOut() {
    if (currentScale <= 0.6) return;
    currentScale -= 0.25;
    queueRenderPage(currentPageNum);
  }

  /**
   * ملاءمة عرض الصفحة تلقائياً مع عرض شاشة المستخدم
   */
  function fitToWidth() {
    if (!containerEl || !currentPdfDoc) return;
    autoScaleForViewport();
    queueRenderPage(currentPageNum);
  }

  function autoScaleForViewport() {
    const containerWidth = containerEl.clientWidth || window.innerWidth;
    if (containerWidth < 600) {
      // شاشات الهواتف
      currentScale = Math.max(0.75, (containerWidth - 32) / 595);
    } else if (containerWidth < 1024) {
      // شاشات التابلت
      currentScale = (containerWidth - 64) / 595;
    } else {
      // شاشات الكمبيوتر
      currentScale = 1.35;
    }
  }

  /**
   * تبديل وضع ملء الشاشة لقراءة مريحة
   */
  function toggleFullscreen() {
    if (!containerEl) return;
    if (!document.fullscreenElement) {
      containerEl.requestFullscreen().catch(err => {
        console.warn('تعذر تفعيل ملء الشاشة:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  /**
   * تنزيل أي ملف PDF بسلامة تامة عبر Blob Object URL
   * هذا يمنع بشكل قاطع اقتطاع الملفات أو تلف الخطوط الناتج عن حدود Data URL في المتصفحات
   */
  async function downloadPdfFile(filePath, filename = 'lecture.pdf') {
    const bytes = currentPdfBytes && filePath === currentFilePath
      ? currentPdfBytes
      : await resolvePdfBytes(filePath);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanName = (filename || 'lecture.pdf').trim();
    a.download = cleanName.endsWith('.pdf') ? cleanName : `${cleanName}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  }

  function downloadCurrentFile() {
    if (!currentFilePath) return;
    const name = currentFileMeta && currentFileMeta.title ? `${currentFileMeta.title}.pdf` : 'lecture.pdf';
    downloadPdfFile(currentFilePath, name).catch(err => console.error('تعذر تنزيل PDF:', err));
  }

  /**
   * فتح الملف في لسان نافذة جديدة باستخدام Blob Object URL
   * يضمن تشغيل القارئ الأصلي للنظام بدون حجب متصفح Chrome لروابط data:
   */
  async function openPdfFile(filePath) {
    const bytes = currentPdfBytes && filePath === currentFilePath
      ? currentPdfBytes
      : await resolvePdfBytes(filePath);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    if (!tab) {
      URL.revokeObjectURL(url);
      throw new Error('تعذر فتح نافذة جديدة. يرجى السماح بالنوافذ المنبثقة من إعدادات المتصفح ثم المحاولة ثانية.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function openInNewTab() {
    if (!currentFilePath) return;
    openPdfFile(currentFilePath).catch(err => {
      console.error('تعذر فتح PDF:', err);
      alert(err.message || 'تعذر فتح الملف في نافذة جديدة.');
    });
  }

  /**
   * عارض احتياطي في حال عدم عمل Canvas أو PDF.js
   */
  function renderFallbackViewer(filePath, errMsg = '') {
    const viewportEl = containerEl ? containerEl.querySelector('.pdf-canvas-viewport') : null;
    if (!viewportEl) return;

    viewportEl.innerHTML = `
      <div class="pdf-state-overlay" style="display: flex;">
        <div style="font-size: 2.5rem; color: var(--accent);">📄</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0.5rem 0;">عرض ملف المحاضرة</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 440px; margin-bottom: 1.25rem;">
          ${errMsg ? `تنبيه: ${errMsg}.` : 'يمكنك فتح الملف مباشرة بالقارئ المعتمد لمتصفحك أو تنزيله بكامل دقة الخطوط الأصلية.'}
        </p>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center;">
          <button id="pdf-fallback-open-btn" class="btn-primary" style="padding: 0.65rem 1.25rem; font-size: 0.85rem;">
            فتح في نافذة جديدة
          </button>
          <button id="pdf-fallback-download-btn" class="btn-file-read" style="padding: 0.65rem 1.25rem; font-size: 0.85rem;">
            تنزيل ملف المحاضرة
          </button>
        </div>
      </div>
    `;

    const openBtn = viewportEl.querySelector('#pdf-fallback-open-btn');
    if (openBtn) openBtn.addEventListener('click', () => openPdfFile(filePath).catch(console.error));
    const dlBtn = viewportEl.querySelector('#pdf-fallback-download-btn');
    if (dlBtn) dlBtn.addEventListener('click', () => downloadCurrentFile());
  }

  function showLoading(show) {
    if (loadingEl) {
      loadingEl.style.display = show ? 'flex' : 'none';
    }
  }

  function showError(show, message) {
    if (errorEl) {
      errorEl.style.display = show ? 'flex' : 'none';
      if (message && errorEl.querySelector('p')) {
        errorEl.querySelector('p').textContent = message;
      }
    }
  }

  function updateControlStates() {
    const prevBtn = document.getElementById('pdf-btn-prev');
    const nextBtn = document.getElementById('pdf-btn-next');
    if (prevBtn) prevBtn.disabled = currentPageNum <= 1;
    if (nextBtn) nextBtn.disabled = currentPageNum >= totalNumPages;
  }

  /**
   * دعم التمرير باللمس على أجهزة iPhone و iPad
   */
  function setupTouchGestures() {
    let touchStartX = 0;
    let touchEndX = 0;

    if (!containerEl) return;

    containerEl.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    containerEl.addEventListener('touchend', e => {
      touchEndX = e.changedTouches[0].screenX;
      handleGesture();
    }, { passive: true });

    function handleGesture() {
      const diff = touchEndX - touchStartX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          prevPage();
        } else {
          nextPage();
        }
      }
    }
  }

  return {
    init,
    loadDocument,
    prevPage,
    nextPage,
    zoomIn,
    zoomOut,
    fitToWidth,
    toggleFullscreen,
    downloadCurrentFile,
    openInNewTab,
    downloadPdfFile,
    openPdfFile
  };
})();

window.PDFViewer = PDFViewer;
