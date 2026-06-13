/* GESPPASS PWA Service Worker
 * 策略:一切请求走网络(保证内容永远最新,不破坏频繁部署);
 * 仅当"页面导航 + 完全断网"时,展示离线兜底页。不缓存任何业务数据。 */
const VER = 'gesppass-pwa-v1';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VER).then((c) => c.add('/offline.html')));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
  }
});
