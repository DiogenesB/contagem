/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · PEÇAS DE APP (PWA) PARA AS TELAS
   O mesmo comportamento de app em todas as telas (operador, mapa,
   layout). O painel tem o painel-app.js, que faz isto e mais.

   Uso:  <script src="./pwa.js" defer data-app="layout"
                 data-nome="Layout 3D" data-cor="--surface"
                 data-instalar="sim" data-offline="sim"></script>
     data-app       chave da tela (lembra o "agora não" de cada uma)
     data-nome      nome que aparece no aviso de instalar
     data-cor       variável CSS da cor da barra do sistema (opcional)
     data-instalar  "nao" quando a tela já tem o próprio botão
     data-offline   "nao" quando a tela já avisa que caiu a rede
     data-baixo     px livres embaixo (barra de abas da tela), para o aviso não cobrir

   Faz: registra o service worker, avisa quando há versão nova,
   oferece instalar (Android/Chrome e o caminho do iPhone), mostra
   uma faixa sem internet e pinta a barra do sistema no tema.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const eu = document.currentScript || document.querySelector('script[src*="pwa.js"]');
  const cfg = { app:'app', nome:'o app', cor:'', instalar:'sim', offline:'sim', baixo:'0', ...(eu?.dataset || {}) };
  const raiz = document.documentElement;
  const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const celular = () => matchMedia('(max-width:900px)').matches;
  const ler = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  raiz.classList.toggle('app-instalado', instalado());

  /* Visual próprio, com as cores de cada tela quando existem. */
  const css = document.createElement('style');
  css.textContent = `
.pwa-aviso{position:fixed;z-index:9000;left:50%;bottom:calc(${(+cfg.baixo || 0) + 12}px + env(safe-area-inset-bottom,0px));transform:translate(-50%,16px);opacity:0;pointer-events:none;
  width:min(440px,calc(100vw - 24px));display:flex;align-items:center;gap:10px 12px;flex-wrap:wrap;padding:12px 14px;
  background:var(--surface,var(--bg2,#15181C));color:var(--text-2,var(--muted,#A2A9B4));
  border:1px solid var(--line-2,var(--border2,var(--line,#35363B)));border-left:3px solid var(--accent,var(--green,#4C8DF6));
  border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.28);font:13px/1.45 var(--sans,var(--f-ui,'IBM Plex Sans',system-ui,sans-serif));transition:opacity .2s,transform .2s}
.pwa-aviso.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.pwa-aviso b{color:var(--text,var(--ink,#F3F4F6))}
.pwa-aviso-txt{flex:1 1 220px}
.pwa-aviso-bts{display:flex;gap:6px;margin-left:auto}
.pwa-aviso button{font:600 13px/1 inherit;font-family:inherit;border-radius:7px;padding:10px 14px;min-height:38px;cursor:pointer;border:1px solid transparent;background:transparent;color:inherit}
.pwa-aviso button.p{background:var(--accent,var(--green,#4C8DF6));color:#fff}
.pwa-off{display:none}
html.pwa-sem-rede .pwa-off{display:block;position:fixed;z-index:8999;top:env(safe-area-inset-top,0px);left:0;right:0;text-align:center;padding:5px 12px;
  font:600 12px/1.4 var(--sans,var(--f-ui,system-ui,sans-serif));background:#E5A23C;color:#1B1405}
@media (prefers-reduced-motion:reduce){.pwa-aviso{transition:none}}`;
  document.head.appendChild(css);

  function aviso(id, html, botoes) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'pwa-aviso'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<div class="pwa-aviso-txt">${html}</div><div class="pwa-aviso-bts">${botoes.map((b, i) => `<button type="button" class="${b.p ? 'p' : ''}" data-i="${i}">${b.rot}</button>`).join('')}</div>`;
    el.onclick = e => { const b = e.target.closest('[data-i]'); if (b) botoes[+b.dataset.i].acao(); };
    requestAnimationFrame(() => el.classList.add('show'));
  }
  const fechar = id => { const el = document.getElementById(id); if (el) { el.classList.remove('show'); setTimeout(() => el.remove(), 250); } };

  /* Service worker e versão nova. */
  if ('serviceWorker' in navigator) {
    const tinha = !!navigator.serviceWorker.controller;
    let indo = false;
    navigator.serviceWorker.register('./sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!tinha || indo) return;
      aviso('pwa-versao', '<b>Versão nova disponível.</b> Toque para carregar.', [
        { rot:'Atualizar', p:true, acao:() => { indo = true; location.reload(); } },
        { rot:'Depois', acao:() => fechar('pwa-versao') },
      ]);
    });
  }

  /* Cor da barra do sistema no tema da tela. */
  if (cfg.cor) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    const pintar = () => { const c = getComputedStyle(raiz).getPropertyValue(cfg.cor).trim(); if (c) meta.content = c; };
    pintar();
    new MutationObserver(pintar).observe(raiz, { attributes:true, attributeFilter:['data-tema', 'class'] });
  }

  /* Sem internet. */
  if (cfg.offline !== 'nao') {
    const off = document.createElement('div');
    off.className = 'pwa-off'; off.setAttribute('role', 'status');
    off.textContent = 'Sem internet — o que está na tela pode estar desatualizado.';
    document.body.appendChild(off);
    const ver = () => raiz.classList.toggle('pwa-sem-rede', !navigator.onLine);
    addEventListener('online', ver); addEventListener('offline', ver); ver();
  }

  /* Instalar. */
  if (cfg.instalar !== 'nao' && !instalado()) {
    const chave = `pwa-nao-${cfg.app}`;
    const nao = +ler(chave); if (nao && Date.now() - nao > 30 * 864e5) guardar(chave, null);
    let pedido = null;
    const instalar = () => {
      fechar('pwa-instalar');
      if (pedido) { pedido.prompt(); pedido.userChoice.finally(() => { pedido = null; }); return; }
      if (iOS) aviso('pwa-instalar', '<b>No iPhone:</b> toque em <b>Compartilhar</b> (□↑) no Safari e depois em <b>Adicionar à Tela de Início</b>.', [{ rot:'Entendi', p:true, acao:() => fechar('pwa-instalar') }]);
    };
    const oferecer = () => {
      if (instalado() || ler(chave) || !celular()) return;
      aviso('pwa-instalar', `<b>Instale ${cfg.nome} no celular.</b> Abre em tela cheia, fica na tela inicial e carrega mais rápido.`, [
        { rot:'Instalar', p:true, acao:instalar },
        { rot:'Agora não', acao:() => { guardar(chave, String(Date.now())); fechar('pwa-instalar'); } },
      ]);
    };
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedido = e; setTimeout(oferecer, 4000); });
    addEventListener('appinstalled', () => { pedido = null; fechar('pwa-instalar'); });
    if (iOS) setTimeout(oferecer, 4000);
    window.pwaInstalar = instalar;
  }
})();
