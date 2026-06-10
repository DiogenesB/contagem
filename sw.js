/* Service Worker — Simbiose Expedição PWA */
const CACHE = 'simbiose-v2';
const URLS  = ['./mobile.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Só intercepta GET (POST/PATCH/DELETE do Supabase passam direto)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Requisições de API (Supabase etc.) nunca passam pelo cache
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');

  if (isHTML) {
    // NETWORK FIRST para HTML: deploy novo chega na hora;
    // cache só é usado quando offline.
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./mobile.html')))
    );
    return;
  }

  // CACHE FIRST para o resto (manifest, ícones…), atualizando em background
  e.respondWith(
    caches.match(req).then(cached => {
      const fetched = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// Clique na notificação abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow('./mobile.html');
    })
  );
});
