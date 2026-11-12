/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · PAINEL COMO APP (PWA)

   Tudo o que faz o painel virar aplicativo no celular, sem mexer na
   tela do computador:
     · service worker, aviso de versão nova e instalação (Android,
       iPhone e computador);
     · barra de abas embaixo (Hoje, Saldo, Mapa, Analista, Mais);
     · botão voltar do celular: volta de tela e fecha janela/menu;
     · puxar para atualizar a tela aberta;
     · aviso de sem internet e cor da barra do sistema no tema.
   Carregado no fim do painel.html, depois de todos os outros scripts.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const raiz = document.documentElement;
  const celular = matchMedia('(max-width:760px)');
  const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const ler = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  raiz.classList.toggle('app-instalado', instalado());

  /* ═══════════ AVISO NO RODAPÉ (versão nova, instalar) ═══════════ */
  function aviso(id, html, botoes) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'app-aviso'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<div class="app-aviso-txt">${html}</div><div class="app-aviso-bts">${botoes.map((b, i) => `<button class="btn btn-sm${b.primario ? ' btn-primary' : ' btn-ghost'}" data-i="${i}">${b.rot}</button>`).join('')}</div>`;
    el.onclick = e => { const b = e.target.closest('[data-i]'); if (b) botoes[+b.dataset.i].acao(); };
    requestAnimationFrame(() => el.classList.add('show'));
    return el;
  }
  const fecharAviso = id => { const el = document.getElementById(id); if (el) { el.classList.remove('show'); setTimeout(() => el.remove(), 250); } };

  /* ═══════════ SERVICE WORKER ═══════════ */
  if ('serviceWorker' in navigator) {
    const tinha = !!navigator.serviceWorker.controller;
    let recarregando = false;
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // Volta para o app depois de um tempo: procura deploy novo.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      setInterval(() => { if (!document.hidden) reg.update().catch(() => {}); }, 30 * 60e3);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!tinha || recarregando) return;
      aviso('app-versao', '<b>Painel atualizado.</b> Toque para carregar a versão nova.', [
        { rot:'Atualizar', primario:true, acao:() => { recarregando = true; location.reload(); } },
        { rot:'Depois', acao:() => fecharAviso('app-versao') },
      ]);
    });
  }

  /* ═══════════ COR DA BARRA DO SISTEMA ═══════════ */
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  const pintarBarra = () => { meta.content = getComputedStyle(raiz).getPropertyValue('--surface').trim() || '#15181C'; };
  pintarBarra();
  new MutationObserver(pintarBarra).observe(raiz, { attributes:true, attributeFilter:['data-tema'] });

  /* ═══════════ ABAS EMBAIXO (celular) ═══════════ */
  const ABAS = [['hoje', 'Hoje'], ['saldo', 'Saldo'], ['mapa', 'Mapa'], ['analista', 'Analista']];
  const icone = p => document.querySelector(`.nav-item[data-page="${p}"] svg`)?.outerHTML || '';
  const tabs = document.createElement('nav');
  tabs.className = 'app-tabs'; tabs.id = 'app-tabs'; tabs.setAttribute('aria-label', 'Telas principais');
  tabs.innerHTML = ABAS.map(([p, r]) => `<button type="button" data-aba="${p}">${icone(p)}<span>${r}</span>${p === 'hoje' ? '<b class="app-badge" id="app-badge-hoje" hidden></b>' : ''}</button>`).join('')
    + `<button type="button" data-aba="mais" aria-label="Mais telas e menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg><span>Mais</span></button>`;
  document.body.appendChild(tabs);
  const paginaAtual = () => document.querySelector('.page.active')?.id?.replace('page-', '') || '';
  function pintarAbas() {
    const p = paginaAtual(), aberta = document.querySelector('.side')?.classList.contains('open');
    tabs.querySelectorAll('button').forEach(b => {
      const on = b.dataset.aba === 'mais' ? aberta || (!aberta && !ABAS.some(a => a[0] === p)) : !aberta && b.dataset.aba === p;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const side = document.querySelector('.side');
    if (b.dataset.aba === 'mais') { side?.classList.toggle('open'); pintarAbas(); return; }
    side?.classList.remove('open');
    if (paginaAtual() === b.dataset.aba) { window.scrollTo({ top:0, behavior:'smooth' }); return; }   // tocar de novo: volta ao topo
    irPara(b.dataset.aba);
  });
  // Contador do "Hoje" igual ao do menu.
  const nc = document.getElementById('nc-hoje'), badge = document.getElementById('app-badge-hoje');
  const copiarBadge = () => { if (!nc || !badge) return; badge.textContent = nc.textContent; badge.hidden = nc.hidden || !nc.textContent || nc.textContent === '0'; };
  if (nc) { new MutationObserver(copiarBadge).observe(nc, { attributes:true, childList:true, characterData:true, subtree:true }); copiarBadge(); }
  // A página ativa e a gaveta mudam por vários caminhos: observa.
  document.querySelectorAll('.page').forEach(pg => new MutationObserver(pintarAbas).observe(pg, { attributes:true, attributeFilter:['class'] }));
  const side = document.querySelector('.side');
  if (side) new MutationObserver(pintarAbas).observe(side, { attributes:true, attributeFilter:['class'] });
  pintarAbas();

  /* Filial com nome curto no celular (cabe no cabeçalho). */
  const filial = document.getElementById('filtro-filial');
  const CURTO = { '':'Todas', simbiose:'Simbiose', bioma:'Bioma', biagro:'Biagro' };
  function nomesFilial() {
    if (!filial) return;
    for (const o of filial.options) {
      o.dataset.longo ||= o.textContent;
      o.textContent = celular.matches && CURTO[o.value] ? CURTO[o.value] : o.dataset.longo;
    }
  }
  nomesFilial(); celular.addEventListener?.('change', nomesFilial);

  /* Teclado aberto: as abas somem para não cobrir o campo. */
  if (window.visualViewport) {
    const ver = () => raiz.classList.toggle('teclado', celular.matches && window.innerHeight - visualViewport.height > 140);
    visualViewport.addEventListener('resize', ver);
  }

  /* ═══════════ BOTÃO VOLTAR ═══════════
     Cada tela nova entra no histórico (antes só substituía): o voltar
     do celular volta para a tela anterior em vez de fechar o app.
     Janela, gaveta do menu e menus de cima fecham com o voltar. */
  if (typeof irPara === 'function') {
    const irParaOriginal = irPara;
    window.irPara = irPara = function (pagina) {
      const alvo = pagina === 'saldo-erp' ? 'saldo' : pagina;
      const atual = location.hash.replace('#', '');
      if (document.getElementById('page-' + alvo) && atual !== alvo) {
        if (atual) history.pushState(null, '', '#' + alvo);
        else history.replaceState(null, '', '#' + alvo);
      }
      return irParaOriginal(pagina);
    };
  }
  let ignorarVolta = 0;
  const camadas = [];                      // o que está aberto por cima da tela, na ordem
  function abriu(el) {
    if (camadas.includes(el)) return;
    camadas.push(el);
    history.pushState({ camada:true, n:camadas.length }, '', location.href);
  }
  function fechou(el) {
    const i = camadas.indexOf(el); if (i < 0) return;
    camadas.splice(i, 1);
    if (history.state?.camada) { ignorarVolta++; history.back(); }
  }
  const aberto = el => el.classList.contains('side') ? el.classList.contains('open') && celularOuGaveta()
    : el.classList.contains('dropdown') ? el.classList.contains('open') : el.classList.contains('open');
  const celularOuGaveta = () => matchMedia('(max-width:1100px)').matches;
  function vigiar(el) {
    new MutationObserver(() => (aberto(el) ? abriu(el) : fechou(el))).observe(el, { attributes:true, attributeFilter:['class'] });
  }
  if (side) vigiar(side);
  document.querySelectorAll('.modal-bg').forEach(vigiar);
  // Janelas criadas depois (ex.: login, impressão) também entram.
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList?.contains('modal-bg')) vigiar(n); })
    .observe(document.body, { childList:true });
  window.addEventListener('popstate', () => {
    if (ignorarVolta) { ignorarVolta--; return; }
    const topo = camadas.pop();
    if (!topo) return;
    if (topo.classList.contains('side')) topo.classList.remove('open');
    else topo.classList.remove('open');
  });

  /* ═══════════ PUXAR PARA ATUALIZAR ═══════════ */
  const ptr = document.createElement('div');
  ptr.className = 'app-ptr'; ptr.setAttribute('aria-hidden', 'true');
  ptr.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-2.64-6.36"/><path d="M21 4v5h-5"/></svg>';
  document.body.appendChild(ptr);
  function atualizarTela() {
    const pg = document.querySelector('.page.active'); if (!pg) return;
    const bt = pg.querySelector('#sa-bt-atu') || [...pg.querySelectorAll('.page-head button, .panel-head button, .btn-row button, button')]
      .find(b => /^atualizar/i.test(b.textContent.trim()) && !b.disabled && b.offsetParent !== null);
    if (bt) bt.click(); else irPara(paginaAtual());
  }
  let y0 = null, puxou = 0, girando = false;
  const LIMITE = 72;
  const podePuxar = t => celular.matches && !girando && window.scrollY <= 0
    && !t.closest('.modal-bg, .side, .dropdown, .app-tabs, input, textarea, select, [contenteditable], .tbl-wrap, .m-grade, canvas, svg.an-graf')
    && !document.querySelector('.modal-bg.open');
  document.addEventListener('touchstart', e => { y0 = e.touches.length === 1 && podePuxar(e.target) ? e.touches[0].clientY : null; puxou = 0; }, { passive:true });
  document.addEventListener('touchmove', e => {
    if (y0 == null) return;
    const d = e.touches[0].clientY - y0;
    if (d <= 0 || window.scrollY > 0) { puxou = 0; ptr.classList.remove('vis'); return; }
    puxou = Math.min(120, d * 0.55);
    ptr.classList.add('vis');
    ptr.style.transform = `translate(-50%, ${puxou}px) rotate(${puxou * 3}deg)`;
    ptr.classList.toggle('pronto', puxou >= LIMITE);
  }, { passive:true });
  document.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    if (puxou >= LIMITE) {
      girando = true; ptr.classList.add('girando'); ptr.style.transform = `translate(-50%, ${LIMITE * .8}px)`;
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
      atualizarTela();
      setTimeout(() => { girando = false; ptr.classList.remove('girando', 'vis', 'pronto'); ptr.style.transform = ''; }, 1100);
    } else { ptr.classList.remove('vis', 'pronto'); ptr.style.transform = ''; }
    puxou = 0;
  });

  /* ═══════════ SEM INTERNET ═══════════ */
  const off = document.createElement('div');
  off.className = 'app-offline'; off.setAttribute('role', 'status');
  off.textContent = 'Sem internet — o que está na tela pode estar desatualizado.';
  document.body.appendChild(off);
  const verRede = () => raiz.classList.toggle('sem-rede', !navigator.onLine);
  addEventListener('online', () => { verRede(); if (typeof toast === 'function') toast('Internet de volta. Puxe para baixo para atualizar.', 'ok', 3500); });
  addEventListener('offline', verRede);
  verRede();

  /* ═══════════ INSTALAR ═══════════ */
  let pedido = null;
  const itemMenu = document.createElement('button');
  itemMenu.className = 'dd-op'; itemMenu.id = 'cfg-instalar'; itemMenu.hidden = true;
  itemMenu.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3"/></svg>Instalar o painel como app';
  itemMenu.onclick = () => { if (typeof fecharMenusTopo === 'function') fecharMenusTopo(); instalar(); };
  document.querySelector('#dd-config .dd-grupo')?.appendChild(itemMenu);
  function instalar() {
    fecharAviso('app-instalar');
    if (pedido) {
      pedido.prompt();
      pedido.userChoice.finally(() => { pedido = null; itemMenu.hidden = true; });
      return;
    }
    if (iOS) {
      aviso('app-instalar', '<b>No iPhone:</b> toque em <b>Compartilhar</b> <span class="app-ios-ico" aria-hidden="true">⬆</span> no Safari e depois em <b>Adicionar à Tela de Início</b>.', [{ rot:'Entendi', primario:true, acao:() => fecharAviso('app-instalar') }]);
    }
  }
  function oferecer() {
    if (instalado() || ler('painel-app-nao') || !celular.matches) return;
    aviso('app-instalar', '<b>Use o painel como app.</b> Abre em tela cheia, fica na tela inicial e carrega mais rápido.', [
      { rot:'Instalar', primario:true, acao:instalar },
      { rot:'Agora não', acao:() => { guardar('painel-app-nao', String(Date.now())); fecharAviso('app-instalar'); } },
    ]);
  }
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); pedido = e; itemMenu.hidden = false;
    setTimeout(oferecer, 4000);
  });
  addEventListener('appinstalled', () => {
    pedido = null; itemMenu.hidden = true; fecharAviso('app-instalar');
    if (typeof toast === 'function') toast('Painel instalado. Abra pelo ícone na tela inicial.', 'ok', 4500);
  });
  if (iOS && !instalado()) { itemMenu.hidden = false; setTimeout(oferecer, 4000); }
  // "Agora não" vale por 30 dias.
  const nao = +ler('painel-app-nao'); if (nao && Date.now() - nao > 30 * 864e5) guardar('painel-app-nao', null);

  window.painelApp = { instalar, atualizarTela, instalado };
})();
