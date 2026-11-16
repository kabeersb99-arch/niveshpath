// NiveshPath service worker.
// Network first, so a new release or new data shows at once. Every successful response is cached, and the cache answers when offline.
const VERSION = 'np-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/finance.js', 'js/content.js', 'js/content2.js', 'js/content3.js', 'js/cas.js', 'data/bundle.js', 'data/live.json', 'data/facts.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(VERSION).then((c) => c.put(e.request, copy))); }
      return res;
    } catch {
      return (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' ? await caches.match('index.html') : Response.error());
    }
  })());
});
