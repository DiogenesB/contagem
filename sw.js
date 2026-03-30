/* ══════════════════════════════════════════
   SERVICE WORKER — Simbiose Expedição
   Notificações push para agenda e transferências
══════════════════════════════════════════ */

const CACHE_NAME = 'simbiose-v1';
const SUPABASE_URL = 'https://yuaboypybjqxxgntfyrq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IbvCmbnbazxMGcQTF9-mRg_Tt2RkAng';

// ── INSTALL & ACTIVATE ───────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// ── NOTIFICAÇÃO AO CLICAR ────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── RECEBER PUSH DO SERVIDOR ─────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const payload = e.data.json();
    e.waitUntil(
      self.registration.showNotification(payload.title || 'Simbiose Expedição', {
        body:    payload.body  || '',
        icon:    payload.icon  || '/icon-192.png',
        badge:   payload.badge || '/icon-192.png',
        tag:     payload.tag   || 'simbiose',
        data:    payload.data  || {},
        vibrate: [200, 100, 200],
        requireInteraction: payload.requireInteraction || false,
      })
    );
  } catch(err) { console.error('[SW] push parse error:', err); }
});

// ── POLLING PERIÓDICO (Background Sync fallback) ──
// Verifica agenda e transferências a cada 5 minutos quando o SW está ativo
let _lastAgendaCount  = null;
let _lastTransfCount  = null;

async function fetchCount(table, filters) {
  try {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=id`;
    for (const [k, v] of Object.entries(filters)) {
      url += `&${k}=in.(${v.join(',')})`;
    }
    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
        'Range': '0-0',
      }
    });
    const range = r.headers.get('content-range');
    // content-range: 0-0/TOTAL
    if (range) return parseInt(range.split('/')[1]) || 0;
    return 0;
  } catch(e) { return null; }
}

async function verificarENotificar() {
  // Agenda
  const agendaCount = await fetchCount('agendamentos', { status: ['pendente','em_contagem'] });
  if (agendaCount !== null && _lastAgendaCount !== null && agendaCount > _lastAgendaCount) {
    const novos = agendaCount - _lastAgendaCount;
    await self.registration.showNotification('📋 Nova Agenda — Simbiose Expedição', {
      body:    `${novos} novo${novos > 1 ? 's itens' : ' item'} adicionado${novos > 1 ? 's' : ''} à agenda de contagem.`,
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      tag:     'agenda-nova',
      vibrate: [200, 100, 200],
      data:    { url: '/mobile/' },
    });
  }
  if (agendaCount !== null) _lastAgendaCount = agendaCount;

  // Transferências
  const transfCount = await fetchCount('transferencias', { status: ['pendente'] });
  if (transfCount !== null && _lastTransfCount !== null && transfCount > _lastTransfCount) {
    const novos = transfCount - _lastTransfCount;
    await self.registration.showNotification('🔄 Nova Transferência — Simbiose Expedição', {
      body:    `${novos} nova${novos > 1 ? 's transferências pendentes' : ' transferência pendente'} aguardando confirmação.`,
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      tag:     'transf-nova',
      vibrate: [300, 100, 300],
      data:    { url: '/mobile/' },
      requireInteraction: true,
    });
  }
  if (transfCount !== null) _lastTransfCount = transfCount;
}

// Polling a cada 5 minutos via setInterval no SW
// (funciona enquanto o SW está ativo; combinado com periodic background sync quando disponível)
setInterval(verificarENotificar, 5 * 60 * 1000);

// ── PERIODIC BACKGROUND SYNC ─────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'simbiose-check') {
    e.waitUntil(verificarENotificar());
  }
});

// ── MENSAGEM DA PÁGINA ────────────────────
// A página pode enviar counts iniciais para calibrar o baseline
self.addEventListener('message', e => {
  if (e.data?.type === 'SET_BASELINE') {
    _lastAgendaCount = e.data.agendaCount ?? _lastAgendaCount;
    _lastTransfCount = e.data.transfCount ?? _lastTransfCount;
  }
  if (e.data?.type === 'CHECK_NOW') {
    verificarENotificar();
  }
});