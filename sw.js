/* Service Worker — Simbiose Operador
   v14: network-first no HTML (deploy novo chega na hora),
        cache-first no resto, API nunca passa pelo cache,
        e Background Sync para esvaziar a fila de lançamentos
        mesmo com o app fechado. */
const CACHE = 'simbiose-v59';
const CACHE_CDN = 'simbiose-cdn-v1';
const CDNS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const ESSENCIAIS = ['./mobile.html', './mapa.html', '/assets/js/comum/comum.js', '/assets/js/comum/usuarios.js', '/assets/js/operador/fila.js', '/assets/js/comum/impressao.js', '/assets/js/comum/leitor.js', '/assets/manifests/operador.json', '/assets/manifests/mapa.json'];

const SUPABASE_URL = 'https://yuaboypybjqxxgntfyrq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IbvCmbnbazxMGcQTF9-mRg_Tt2RkAng';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falha inteiro se um arquivo faltar; um a um é mais
      // tolerante a deploy parcial.
      .then(c => Promise.allSettled(ESSENCIAIS.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CACHE_CDN).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST/PATCH/DELETE passam direto

  const url = new URL(req.url);
  // Bibliotecas e fontes de CDN: guarda uma cópia para o app abrir sem internet
  // (usa a guardada na hora e atualiza por trás). Dados do Supabase nunca.
  if (CDNS.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE_CDN).then(c => c.match(req).then(guardada => {
      const rede = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => guardada);
      return guardada || rede;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;        // Supabase e outros domínios passam direto

  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html');

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then(res => {
          // Guarda sem a query (?app=1), para abrir offline de qualquer jeito.
          if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(url.origin + url.pathname, copia)); }
          return res;
        })
        // Sem rede: a última versão guardada desta tela (o painel abre com ?app=1 quando instalado).
        .catch(() => caches.match(req, { ignoreSearch:true }).then(r => r
          || caches.match((url.pathname === '/' || /painel/.test(url.pathname)) ? './painel.html' : /mapa/.test(url.pathname) ? './mapa.html' : /layout/.test(url.pathname) ? './layout.html' : './mobile.html', { ignoreSearch:true })))
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

/* ═══════════════════════════════════════════════════════════════
   FILA OFFLINE
   Se o app estiver aberto, quem envia é ele — o service worker só
   avisa. Isso evita os dois enviarem o mesmo lançamento e criar
   contagem duplicada. Só quando não há nenhuma janela aberta é
   que o worker envia por conta própria.
   ═══════════════════════════════════════════════════════════════ */
const FILA_DB = 'simbiose-fila';
const FILA_LOJA = 'pendentes';

function abrirBanco() {
  return new Promise((ok, falha) => {
    const req = indexedDB.open(FILA_DB, 1);
    req.onsuccess = () => ok(req.result);
    req.onerror   = () => falha(req.error);
  });
}

function lerFila(db) {
  return new Promise((ok, falha) => {
    const req = db.transaction(FILA_LOJA, 'readonly').objectStore(FILA_LOJA).getAll();
    req.onsuccess = () => ok(req.result || []);
    req.onerror   = () => falha(req.error);
  });
}

function apagarDaFila(db, id) {
  return new Promise((ok, falha) => {
    const req = db.transaction(FILA_LOJA, 'readwrite').objectStore(FILA_LOJA).delete(id);
    req.onsuccess = () => ok();
    req.onerror   = () => falha(req.error);
  });
}

async function esvaziarFila() {
  const janelas = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  if (janelas.length) {
    for (const c of janelas) c.postMessage({ tipo:'enviar-fila' });
    return;
  }

  let db;
  try { db = await abrirBanco(); } catch (e) { return; }
  let itens = [];
  try { itens = await lerFila(db); } catch (e) { return; }
  if (!itens.length) return;

  let enviados = 0;
  for (const item of itens) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${item.tabela}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(item.linha),
      });
      if (res.ok) { await apagarDaFila(db, item.id); enviados++; continue; }
      if (res.status >= 500) break;          // servidor ruim: tenta de novo depois
      await apagarDaFila(db, item.id);       // 4xx: o banco recusou, insistir não resolve
    } catch (e) {
      break;                                  // rede caiu: para e espera o próximo sync
    }
  }

  if (enviados && self.registration.showNotification) {
    self.registration.showNotification('Simbiose', {
      body: enviados === 1 ? '1 lançamento enviado.' : `${enviados} lançamentos enviados.`,
      tag: 'fila-simbiose',
    });
  }
}

self.addEventListener('sync', e => {
  if (e.tag === 'enviar-fila') e.waitUntil(esvaziarFila());
});

self.addEventListener('message', e => {
  if (e.data?.tipo === 'esvaziar-fila') e.waitUntil?.(esvaziarFila());
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
