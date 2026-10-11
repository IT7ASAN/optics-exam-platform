/**
 * Optics Common Exam Platform - Search Engine
 * محرك بحث محلي وسريع مع دعم معالجة النصوص العربية واختصارات لوحة المفاتيح
 */

const SearchEngine = (() => {
  /**
   * تسوية النص العربي للبحث المرن دون تشويه النص الأصلي
   */
  function normalizeArabic(text) {
    if (!text) return '';
    return text
      .toString()
      .trim()
      .toLowerCase()
      // إزالة حركات التشكيل والتنوين
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // توحيد أشكال الألف
      .replace(/[إأآا]/g, 'ا')
      // توحيد الياء والألف المقصورة
      .replace(/ى/g, 'ي')
      // توحيد التاء المربوطة والهاء
      .replace(/ة/g, 'ه')
      // توحيد المسافات الزائدة
      .replace(/\s+/g, ' ');
  }

  /**
   * البحث الفوري في جميع محاضرات وملفات ومواد المنصة
   */
  function search(query) {
    if (!query || typeof query !== 'string') return [];
    
    const rawTokens = query.trim().split(/\s+/).filter(t => t.length > 0);
    if (rawTokens.length === 0) return [];

    const normTokens = rawTokens.map(normalizeArabic);
    const allFiles = window.DataLayer.getAllFilesFlat();

    const results = [];

    allFiles.forEach(file => {
      const stageNorm = normalizeArabic(file.stageName);
      const subjectNorm = normalizeArabic(file.subjectName);
      const subjectEnNorm = (file.subjectNameEn || '').toLowerCase();
      const codeNorm = (file.subjectCode || '').toLowerCase();
      const titleNorm = normalizeArabic(file.title);
      const descNorm = normalizeArabic(file.description || '');
      const numStr = String(file.number);

      const searchableText = `${stageNorm} ${subjectNorm} ${subjectEnNorm} ${codeNorm} ${titleNorm} ${descNorm} ${numStr}`;

      // فحص تطابق كل الكلمات المدخلة
      const matchesAllTokens = normTokens.every(token => {
        return searchableText.includes(token);
      });

      if (matchesAllTokens) {
        // حساب وزن النتيجة لتقديم الأكثر صلة
        let score = 0;
        const firstToken = normTokens[0];

        if (titleNorm.includes(firstToken)) score += 10;
        if (numStr === firstToken) score += 8;
        if (subjectNorm.includes(firstToken)) score += 6;
        if (stageNorm.includes(firstToken)) score += 4;
        if (descNorm.includes(firstToken)) score += 2;

        results.push({
          file,
          score
        });
      }
    });

    // ترتيب النتائج تنازلياً حسب درجة الملاءمة
    results.sort((a, b) => b.score - a.score);
    return results.map(r => r.file);
  }

  /**
   * إبراز النص المطابق بشكل آمن
   */
  function highlightMatches(text, query) {
    if (!query || !text) return text;
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return text;

    let highlighted = text;
    tokens.forEach(tok => {
      const reg = new RegExp(`(${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      highlighted = highlighted.replace(reg, '<mark class="bg-sky-200 text-sky-900 rounded px-1">$1</mark>');
    });
    return highlighted;
  }

  return {
    normalizeArabic,
    search,
    highlightMatches
  };
})();

window.SearchEngine = SearchEngine;
