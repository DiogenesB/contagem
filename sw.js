/* Service Worker — Simbiose Operador
   v3: network-first no HTML (deploy novo chega na hora),
       cache-first no resto, API nunca passa pelo cache. */
const CACHE = 'simbiose-v8';
const ESSENCIAIS = ['./mobile.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ESSENCIAIS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST/PATCH/DELETE passam direto

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Supabase e CDNs nunca são cacheados

  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./mobile.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cache => {
      const rede = fetch(req).then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(req, copia));
        return res;
      }).catch(() => cache);
      return cache || rede;
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(lista => {
      for (const c of lista) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./mobile.html');
    })
  );
});
