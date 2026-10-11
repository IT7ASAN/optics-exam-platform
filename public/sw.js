const CACHE_NAME = 'optics-platform-v7';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // تخطي طلبات غير الـ GET أو المسارات الحية للبيانات وواجهات البرمجة
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.includes('/api/') ||
    url.pathname.endsWith('.json') ||
    url.searchParams.has('_t')
  ) {
    return;
  }

  // للأصول الثابتة: استجابة سريعة مع التحديث في الخلفية (Stale-While-Revalidate)
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
