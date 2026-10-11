/**
 * Optics Common Exam Platform - In-App PDF Viewer
 * قارئ ملفات PDF متكامل ومحسّن للهاتف والكمبيوتر مع تكبير وتصفح الصفحات
 */

const PDFViewer = (() => {
  let currentPdfDoc = null;
  let currentPageNum = 1;
  let totalNumPages = 0;
  let currentScale = 1.25;
  let isPageRendering = false;
  let pageNumPending = null;
  let currentFilePath = '';
  let currentFileMeta = null;

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

    // تهيئة عمال PDF.js إن توفرت
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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
      if (currentPdfDoc) {
        currentPdfDoc.destroy();
        currentPdfDoc = null;
      }

      let docConfig = {
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true
      };

      if (filePath.startsWith('data:application/pdf;base64,')) {
        const base64Data = filePath.replace('data:application/pdf;base64,', '');
        const rawData = atob(base64Data);
        const bytes = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) {
          bytes[i] = rawData.charCodeAt(i);
        }
        docConfig.data = bytes;
      } else {
        docConfig.url = filePath;
      }

      const loadingTask = window.pdfjsLib.getDocument(docConfig);

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
   * رسم صفحة محددة على عنصر Canvas
   */
  async function renderPage(num) {
    if (!currentPdfDoc || !canvasEl) return;
    isPageRendering = true;
    showLoading(true);

    try {
      const page = await currentPdfDoc.getPage(num);
      
      const viewport = page.getViewport({ scale: currentScale });
      const pixelRatio = window.devicePixelRatio || 1;

      canvasEl.height = viewport.height * pixelRatio;
      canvasEl.width = viewport.width * pixelRatio;
      canvasEl.style.width = `${viewport.width}px`;
      canvasEl.style.height = `${viewport.height}px`;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };

      const renderTask = page.render(renderContext);
      await renderTask.promise;

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
      currentScale = Math.max(0.7, (containerWidth - 32) / 595);
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
   * تنزيل الملف الحالي مباشرة
   */
  function downloadCurrentFile() {
    if (!currentFilePath) return;
    const a = document.createElement('a');
    a.href = currentFilePath;
    a.download = currentFileMeta.title ? `${currentFileMeta.title}.pdf` : 'lecture.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * فتح الملف في لسان نافذة جديدة
   */
  function openInNewTab() {
    if (!currentFilePath) return;
    window.open(currentFilePath, '_blank', 'noopener,noreferrer');
  }

  /**
   * عارض احتياطي في حال عدم عمل Canvas أو PDF.js
   */
  function renderFallbackViewer(filePath, errMsg = '') {
    const viewportEl = containerEl.querySelector('.pdf-canvas-viewport');
    if (!viewportEl) return;

    viewportEl.innerHTML = `
      <div class="pdf-state-overlay">
        <div style="font-size: 2.5rem; color: var(--accent);">📄</div>
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary);">عرض ملف المحاضرة</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 440px;">
          ${errMsg ? `تعذر تشغيل العارض المباشر: ${errMsg}.` : 'يمكنك قراءة الملف وتصفحه مباشرة من خلال المتصفح أو تنزيله.'}
        </p>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center; margin-top: 1rem;">
          <a href="${filePath}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="padding: 0.65rem 1.25rem;">
            فتح الملف في نافذة جديدة
          </a>
          <button onclick="PDFViewer.downloadCurrentFile()" class="btn-file-read" style="padding: 0.65rem 1.25rem;">
            تنزيل ملف PDF
          </button>
        </div>
      </div>
    `;
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
          // سحب لليمين (في الاتجاه العربي: الصفحة التالية أو السابقة حسب التنسيق)
          prevPage();
        } else {
          // سحب لليسار
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
    openInNewTab
  };
})();

window.PDFViewer = PDFViewer;
