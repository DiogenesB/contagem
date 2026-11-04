/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · VISÃO GERAL, CABEÇALHO E MENUS DO PAINEL

   Só interface. A Visão geral não tem regra própria: lê os mesmos
   dados e as mesmas contas da Validação (_vLinhas), do Mapa
   (_ocupacao), das Transferências (_transfers) e da Acurácia
   (historico com saldo_sistema). Nada aqui grava no banco.

   Carregado antes do script do painel; tudo que ele usa do painel
   é chamado só em tempo de execução.
   ═══════════════════════════════════════════════════════════════ */

let _iniCarregado = false;
let _iniMeses     = null;     // acurácia ajustada dos últimos meses
let _iniAtiv      = null;     // últimas alterações (null = trilha não existe)

/* ═══════════ CABEÇALHO ═══════════ */

/* Título e trilha do topo saem do próprio menu: a seção é o rótulo
   acima do item. Uma fonte só — renomear no menu renomeia aqui. */
function atualizarCabecalho(pagina) {
  const bt = document.querySelector(`.nav-item[data-page="${pagina}"]`);
  const nome = bt?.querySelector('span')?.textContent.trim() || 'Painel';
  let secao = 'Simbiose Agro', el = bt?.previousElementSibling;
  while (el && !el.classList.contains('side-label')) el = el.previousElementSibling;
  if (el) secao = el.textContent.trim();
  if ($('tb-trilha')) $('tb-trilha').textContent = secao;
  if ($('tb-pagina')) $('tb-pagina').textContent = nome;
  document.title = `${nome} · Simbiose Controle de Estoque`;
}

function alternarSidebar() {
  const mini = document.documentElement.classList.toggle('side-mini');
  try { localStorage.setItem('painel-side', mini ? 'mini' : 'aberta'); } catch { /* modo privado */ }
  atualizarRotulosConfig();
}

function atualizarRotulosConfig() {
  if ($('cfg-tema')) $('cfg-tema').textContent = document.documentElement.getAttribute('data-tema') === 'claro' ? 'Claro' : 'Escuro';
  if ($('cfg-side')) $('cfg-side').textContent = document.documentElement.classList.contains('side-mini') ? 'Recolhido' : 'Aberto';
}

/* O nome do gestor continua morando em #gestor-nome (o painel escreve
   lá). O avatar só acompanha. */
function atualizarUsuario() {
  const nome = ($('gestor-nome')?.textContent || '').trim();
  const tem = nome && nome !== 'definir';
  const ini = tem ? iniciais(nome) : '?';
  ['usuario-av', 'usuario-av2'].forEach(id => { if ($(id)) $(id).textContent = ini; });
  if ($('usuario-nome2')) $('usuario-nome2').textContent = tem ? nome : 'Nome não definido';
}

/* ═══════════ MENUS SUSPENSOS ═══════════ */
const MENUS_TOPO = { notif:'notif-btn', config:'config-btn', usuario:'usuario-btn' };

function abrirMenuTopo(qual) {
  const dd = $('dd-' + qual);
  const abrir = !dd.classList.contains('open');
  fecharMenusTopo();
  if (!abrir) return;
  if (qual === 'notif') renderNotificacoes();
  if (qual === 'config') atualizarRotulosConfig();
  dd.classList.add('open');
  $(MENUS_TOPO[qual])?.setAttribute('aria-expanded', 'true');
}
function fecharMenusTopo() {
  for (const [q, bt] of Object.entries(MENUS_TOPO)) {
    $('dd-' + q)?.classList.remove('open');
    $(bt)?.setAttribute('aria-expanded', 'false');
  }
}
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) fecharMenusTopo(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenusTopo(); });

/* ═══════════ PENDÊNCIAS (o sino) ═══════════
   Juntam o que hoje está espalhado pelas abas. Cada item leva para
   a tela onde aquilo se resolve. */
function pendencias() {
  const out = [];
  const linhas = (_vLinhas || []).filter(l => daFilial(l.filial));
  const divs    = linhas.filter(l => !l.validado && !l.extra && l.contado !== null && l.div !== null && l.div !== 0).length;
  const prontas = linhas.filter(l => !l.validado && l.div === 0).length;
  const fora    = linhas.filter(l => l.extra && !l.validado).length;
  const recont  = (_vRecont?.registros || []).filter(r => r.status === 'aberta').length;
  const naoConf = (_naoConf?.length || 0) + (_naoConfFora?.length || 0);
  const tfPend  = (_transfers || []).filter(t => t.status === 'pendente').length;
  const atras   = _atrasados?.length || 0;

  if (divs)    out.push({ c:'neg',  ico:'!', tit:`${num(divs)} linha(s) com divergência`, sub:'Decidir na Validação: recontar, justificar ou aceitar', pg:'validacao' });
  if (fora)    out.push({ c:'alt',  ico:'+', tit:`${num(fora)} lote(s) fora do saldo`, sub:'Contados, mas não existem na planilha do ERP', pg:'validacao' });
  if (naoConf) out.push({ c:'warn', ico:'?', tit:`${num(naoConf)} vaga(s) não confirmada(s)`, sub:'Saíram do mapa no último ciclo e ninguém decidiu', pg:'mapa' });
  if (atras)   out.push({ c:'warn', ico:'↺', tit:`${num(atras)} lançamento(s) de ciclo anterior`, sub:'Pendentes desde antes do ciclo atual', pg:'registros' });
  if (recont)  out.push({ c:'info', ico:'#', tit:`${num(recont)} recontagem(ns) aberta(s)`, sub:'Aguardando o conferente no celular', pg:'validacao' });
  if (tfPend)  out.push({ c:'info', ico:'⇄', tit:`${num(tfPend)} transferência(s) aguardando`, sub:'O operador ainda não confirmou no celular', pg:'transferencias' });
  if (prontas) out.push({ c:'pos',  ico:'✓', tit:`${num(prontas)} linha(s) prontas para validar`, sub:'Contado igual ao sistema', pg:'validacao' });
  return out;
}

function renderNotificacoes() {
  const itens = pendencias();
  const acao = itens.filter(i => i.c !== 'pos' && i.c !== 'info').length;
  const n = $('notif-n');
  if (n) { n.textContent = acao > 99 ? '99+' : (acao || ''); n.dataset.n = acao; }
  const lista = $('notif-lista');
  if (!lista) return;
  $('notif-sub').textContent = itens.length ? `${itens.length} item(ns) · ${acao} pedem decisão` : 'tudo em dia';
  lista.innerHTML = itens.length
    ? itens.map(i => `<button class="dd-item" onclick="fecharMenusTopo();irPara('${i.pg}')">
        <span class="dd-ico c-${i.c}">${i.ico}</span>
        <span class="dd-txt"><b>${esc(i.tit)}</b><span>${esc(i.sub)}</span></span></button>`).join('')
    : `<div class="dd-vazio">Nada pendente. As contagens e transferências estão em dia.</div>`;
}

/* ═══════════ VISÃO GERAL ═══════════ */
async function carregarInicio(forcar = false) {
  if (!_iniCarregado || forcar) {
    ['ini-ciclo', 'ini-galpao', 'ini-acur', 'ini-ativ', 'ini-pend'].forEach(id => {
      if ($(id)) $(id).innerHTML = '<div class="skeleton">carregando…</div>';
    });
    if (forcar) cacheInvalidar('mapa');
    await Promise.allSettled([
      carregarValidacao(),
      carregarMapa(),
      carregarTransferencias(),
      carregarAcuraciaMeses(),
      lerAlteracoes({ limite:6 }).then(a => { _iniAtiv = a; }),
    ]);
    _iniCarregado = true;
  }
  renderInicio();
}

/* Mesma conta da aba Acurácia (ajustada: tira o que foi justificado
   por motivo que não é erro de estoque), mês a mês. */
async function carregarAcuraciaMeses(meses = 6) {
  try {
    const h = new Date();
    const de = new Date(h.getFullYear(), h.getMonth() - (meses - 1), 1);
    const linhas = await buscarTudo(() => sb.from('historico')
      .select('codigo, lote, armazem, divergencia, conta_acuracia, filial, created_at')
      .not('saldo_sistema', 'is', null)
      .gte('created_at', de.toISOString()));
    _iniMeses = { linhas, de, meses };
  } catch { _iniMeses = null; }
}

function acuraciaPorMes() {
  if (!_iniMeses) return null;
  const { linhas, de, meses } = _iniMeses;
  const out = [];
  for (let i = 0; i < meses; i++) {
    const d = new Date(de.getFullYear(), de.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const porLote = new Map();
    for (const r of linhas) {
      if (!daFilial(r.filial) || String(r.created_at).slice(0, 7) !== ym) continue;
      const k = chaveLote(r.codigo, r.lote, r.armazem);
      const a = porLote.get(k);
      if (!a || String(r.created_at) > String(a.created_at)) porLote.set(k, r);
    }
    const u = [...porLote.values()];
    const cons = u.filter(r => r.conta_acuracia !== false);
    const ok = cons.filter(r => (Number(r.divergencia) || 0) === 0).length;
    out.push({ ym, rot:d.toLocaleDateString('pt-BR', { month:'short' }).replace('.', ''),
               n:cons.length, ok, p:cons.length ? ok / cons.length * 100 : null });
  }
  return out;
}

function estadoDoCiclo() {
  const linhas = (_vLinhas || []).filter(l => daFilial(l.filial));
  const g = { validadas:0, prontas:0, divergentes:0, nao:0, fora:0 };
  for (const l of linhas) {
    if (l.validado) g.validadas++;
    else if (l.extra) g.fora++;
    else if (l.contado === null) g.nao++;
    else if (l.div === 0) g.prontas++;
    else g.divergentes++;
  }
  const doSaldo = linhas.filter(l => !l.extra).length;
  const contados = linhas.filter(l => !l.extra && l.contado !== null).length;
  return { ...g, total:linhas.length, doSaldo, contados };
}

function ocupacaoPorDI() {
  const out = [];
  for (const pav of ORDEM_PAVILHOES) {
    for (const [di, linhas] of Object.entries(MAPA_POSICOES[pav])) {
      const andares = Math.max(...Object.values(linhas).map(a => Object.keys(a).length));
      const cols = [];
      let tot = 0, ocup = 0;
      // Chaves '10'..'36' contam como número e vêm antes de '01'..'09' — ordena.
      for (const [ln, ands] of Object.entries(linhas).sort((x, y) => x[0].localeCompare(y[0]))) {
        const col = [];
        for (let an = andares; an >= 1; an--) {           // andar de cima em cima
          const lugares = ands[an] || [];
          let o = 0;
          for (const lg of lugares) if (itensDaVaga(`${di}-${ln}-${an}-${lg}`).length) o++;
          tot += lugares.length; ocup += o;
          col.push({ an, o, n:lugares.length });
        }
        cols.push({ ln, col });
      }
      out.push({ pav, di, andares, cols, tot, ocup });
    }
  }
  return out;
}

function renderInicio() {
  if (!$('page-inicio')) return;
  const c = estadoDoCiclo();
  const di = ocupacaoPorDI();
  const vagas = di.reduce((s, d) => s + d.tot, 0);
  const ocup  = di.reduce((s, d) => s + d.ocup, 0);
  const meses = acuraciaPorMes();
  const mesAtual = meses?.[meses.length - 1];
  const tfPend = (_transfers || []).filter(t => t.status === 'pendente').length;
  const encerrada = typeof _contagemEncerrada === 'function' && _contagemEncerrada();

  // ── subtítulo ──
  $('ini-sub').textContent = _ciclo
    ? `Ciclo ${_ciclo.id} aberto em ${fmtDia(_ciclo.iniciado_em)}, há ${diasDesde(_ciclo.iniciado_em)} dia(s) · contagem ${encerrada ? 'encerrada' : 'em andamento'}`
    : 'Nenhum ciclo de contagem aberto. Importe o saldo do ERP na Validação para começar.';

  // ── indicadores ──
  $('ini-kpis').innerHTML = [
    kpi('Cobertura do ciclo', c.doSaldo ? pct(c.contados, c.doSaldo) : '—', `${num(c.contados)} de ${num(c.doSaldo)} linhas conferidas`, 'is-info'),
    kpi('Divergências abertas', num(c.divergentes), c.divergentes ? 'precisam de decisão' : 'nenhuma no momento', c.divergentes ? 'is-neg' : 'is-pos'),
    kpi('Linhas validadas', num(c.validadas), c.total ? `${pct(c.validadas, c.total)} do ciclo` : 'sem ciclo aberto'),
    kpi('Ocupação do drive-in', pct(ocup, vagas), `${num(ocup)} de ${num(vagas)} vagas`),
    kpi('Acurácia do mês', mesAtual?.p != null ? num1(mesAtual.p) + '%' : '—', mesAtual?.n ? `${num(mesAtual.ok)} de ${num(mesAtual.n)} lotes sem divergência` : 'nada validado este mês',
        mesAtual?.p == null ? '' : mesAtual.p >= 98 ? 'is-pos' : mesAtual.p >= 90 ? 'is-warn' : 'is-neg'),
    kpi('Transferências', num(tfPend), tfPend ? 'aguardando o operador' : 'nenhuma pendente', tfPend ? 'is-warn' : ''),
  ].join('');

  renderCicloInicio(c);
  renderPendInicio();
  renderGalpaoInicio(di);
  renderAcurInicio(meses);
  renderAtivInicio();
  renderNotificacoes();
}

/* Progresso do ciclo: uma barra segmentada por estado da linha.
   Cor de estado + rótulo + número na legenda — nunca só a cor. */
function renderCicloInicio(c) {
  const el = $('ini-ciclo');
  if (!c.total) {
    el.innerHTML = `<div class="empty"><div class="empty-ico">▤</div><div class="empty-tit">Sem ciclo de contagem</div>
      <div class="empty-sub">Importe o saldo do ERP na Validação para abrir um ciclo.</div>
      <div style="margin-top:14px"><button class="btn btn-primary btn-sm" onclick="irPara('validacao')">Abrir a Validação</button></div></div>`;
    return;
  }
  const seg = [
    { k:'validadas',   rot:'Validadas',           cor:'pos'  },
    { k:'prontas',     rot:'Prontas para validar', cor:'acc'  },
    { k:'divergentes', rot:'Com divergência',     cor:'neg'  },
    { k:'fora',        rot:'Fora do saldo',       cor:'warn' },
    { k:'nao',         rot:'Não contadas',        cor:'mute' },
  ];
  const bar = seg.filter(s => c[s.k]).map(s =>
    `<i class="c-${s.cor}" style="flex:${c[s.k]} 1 0" data-tip="${s.rot}: ${num(c[s.k])} (${pct(c[s.k], c.total)})"></i>`).join('');
  el.innerHTML = `
    <div class="ini-cobre">
      <div><span class="ini-grande">${pct(c.contados, c.doSaldo)}</span><span class="ini-grande-rot">do saldo já conferido</span></div>
      <div class="ini-cobre-dir">${num(c.total)} linhas no ciclo</div>
    </div>
    <div class="ini-seg" role="img" aria-label="Linhas do ciclo por situação">${bar}</div>
    <div class="ini-leg">${seg.map(s => `
      <button class="ini-leg-it" onclick="irPara('validacao')">
        <i class="c-${s.cor}"></i><span>${s.rot}</span><b>${num(c[s.k])}</b><small>${pct(c[s.k], c.total)}</small>
      </button>`).join('')}
    </div>`;
}

function renderPendInicio() {
  const itens = pendencias();
  $('ini-pend-n').textContent = itens.length ? `${itens.length} item(ns)` : 'tudo em dia';
  $('ini-pend').innerHTML = itens.length
    ? itens.map(i => `<button class="dd-item" onclick="irPara('${i.pg}')">
        <span class="dd-ico c-${i.c}">${i.ico}</span>
        <span class="dd-txt"><b>${esc(i.tit)}</b><span>${esc(i.sub)}</span></span>
        <svg class="ini-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>`).join('')
    : `<div class="dd-vazio">Nada pendente agora.</div>`;
}

/* O galpão em miniatura: cada drive-in é uma grade de linhas (colunas)
   por andares (andar de cima em cima). O tom diz quantas vagas da
   linha+andar estão ocupadas — uma cor só, do claro ao escuro. */
function nivelOcup(o, n) {
  if (!n || !o) return 0;
  const f = o / n;
  return f >= 1 ? 4 : f > .66 ? 3 : f > .33 ? 2 : 1;
}

function renderGalpaoInicio(dis) {
  const porPav = {};
  for (const d of dis) (porPav[d.pav] ||= []).push(d);
  $('ini-galpao').innerHTML = ORDEM_PAVILHOES.map(pav => {
    const ds = porPav[pav] || [];
    const tot = ds.reduce((s, d) => s + d.tot, 0), oc = ds.reduce((s, d) => s + d.ocup, 0);
    return `<div class="gp-pav">
      <div class="gp-pav-cab"><b>Pavilhão ${esc(NOME_PAVILHAO[pav] || pav)}</b><span>${num(oc)} de ${num(tot)} vagas · ${pct(oc, tot)}</span></div>
      <div class="gp-dis">${ds.map(d => `
        <button class="gp-di" style="flex:${d.cols.length} 1 0" onclick="abrirDIInicio('${d.di}')" title="Abrir o drive-in ${d.di} no mapa">
          <div class="gp-di-cab"><span class="gp-di-nome">${d.di}</span><span>${pct(d.ocup, d.tot)}</span></div>
          <div class="gp-grade" style="grid-template-columns:repeat(${d.cols.length}, minmax(5px, 1fr))">
            ${Array.from({ length:d.andares }, (_, r) => d.cols.map(cl => {
              const x = cl.col[r];
              return `<i class="gp-n${nivelOcup(x.o, x.n)}" data-tip="${d.di}-${cl.ln} · andar ${x.an}: ${x.o} de ${x.n} vaga(s) ocupada(s)"></i>`;
            }).join('')).join('')}
          </div>
          <div class="gp-di-pe"><span>linha ${d.cols[0].ln}</span><span>${d.cols[d.cols.length - 1].ln}</span></div>
        </button>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function abrirDIInicio(di) {
  irPara('mapa');
  // O mapa pode ainda estar montando; o escopo é aplicado quando existir.
  const aplicar = () => { try { setEscopoMapa('di:' + di); if ($('m-escopo')) $('m-escopo').value = 'di:' + di; } catch { /* mapa ainda não montou */ } };
  aplicar(); setTimeout(aplicar, 400);
}

/* Acurácia ajustada por mês — colunas de uma série só, eixo de 0 a
   100%, rótulo só no último mês; o resto aparece ao passar o mouse. */
function renderAcurInicio(meses) {
  const el = $('ini-acur');
  if (!meses) { el.innerHTML = `<div class="empty"><div class="empty-tit">Não foi possível ler o histórico</div></div>`; return; }
  if (!meses.some(m => m.n)) {
    el.innerHTML = `<div class="empty"><div class="empty-ico">◎</div><div class="empty-tit">Nada validado nos últimos meses</div><div class="empty-sub">A acurácia aparece conforme os lotes são validados.</div></div>`;
    return;
  }
  const ult = meses.length - 1;
  el.innerHTML = `
    <div class="ac-graf" role="img" aria-label="Acurácia ajustada por mês">
      <div class="ac-eixo"><span>100%</span><span>50%</span><span>0%</span></div>
      <div class="ac-area">
        <div class="ac-grid"><i></i><i></i><i></i></div>
        <div class="ac-cols">${meses.map((m, i) => `
          <div class="ac-col" data-tip="${esc(m.rot)}: ${m.p == null ? 'sem validação' : `${num1(m.p)}% · ${num(m.ok)} de ${num(m.n)} lotes`}">
            ${i === ult && m.p != null ? `<span class="ac-val">${num1(m.p)}%</span>` : ''}
            ${m.p == null ? '<span class="ac-sem">—</span>' : `<i style="height:${Math.max(1.5, m.p).toFixed(1)}%"${i === ult ? ' class="ult"' : ''}></i>`}
          </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="ac-rots">${meses.map(m => `<span>${esc(m.rot)}</span>`).join('')}</div>
    <div class="ac-tab">
      <table><thead><tr><th>Mês</th><th class="num">Lotes</th><th class="num">Sem divergência</th><th class="num">Acurácia</th></tr></thead>
      <tbody>${[...meses].reverse().filter(m => m.n).map(m => `<tr><td>${esc(mesLabel(m.ym))}</td><td class="num">${num(m.n)}</td><td class="num">${num(m.ok)}</td><td class="num strong">${num1(m.p)}%</td></tr>`).join('')}</tbody></table>
    </div>`;
}

function renderAtivInicio() {
  const el = $('ini-ativ');
  if (_iniAtiv === null) { el.innerHTML = `<div class="dd-vazio">A trilha de alterações ainda não está ligada no banco.</div>`; return; }
  el.innerHTML = _iniAtiv.length
    ? `<div class="hist">${_iniAtiv.map(eventoHTML).join('')}</div>`
    : `<div class="dd-vazio">Nenhuma alteração registrada ainda.</div>`;
}

function alternarTabelaAcur(bt) {
  const box = $('ini-acur');
  const on = box.classList.toggle('ver-tabela');
  bt.textContent = on ? 'Ver gráfico' : 'Ver tabela';
}

/* ═══════════ DICA FLUTUANTE ═══════════
   Um elemento só para todas as marcas com data-tip. */
(() => {
  let dica = null;
  const mostrar = e => {
    const alvo = e.target.closest?.('[data-tip]');
    if (!alvo) { if (dica) dica.hidden = true; return; }
    if (!dica) { dica = document.createElement('div'); dica.className = 'dica-flut'; document.body.appendChild(dica); }
    dica.textContent = alvo.dataset.tip;
    dica.hidden = false;
    const r = alvo.getBoundingClientRect();
    const w = dica.offsetWidth, h = dica.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8;
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    if (y < 8) y = r.bottom + 8;
    dica.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  document.addEventListener('mouseover', mostrar);
  document.addEventListener('focusin', mostrar);
  document.addEventListener('scroll', () => { if (dica) dica.hidden = true; }, true);
})();

/* ═══════════ LIGAÇÕES ═══════════ */
document.addEventListener('DOMContentLoaded', () => {
  atualizarRotulosConfig();
  atualizarUsuario();
  // O painel atualiza esses elementos por conta própria; aqui só se
  // acompanha, sem mexer na lógica dele.
  const obs = new MutationObserver(() => { atualizarUsuario(); renderNotificacoes(); });
  ['gestor-nome', 'nc-validacao', 'nc-registros', 'nc-transferencias'].forEach(id => {
    if ($(id)) obs.observe($(id), { childList:true, characterData:true, subtree:true });
  });
  new MutationObserver(atualizarRotulosConfig).observe(document.documentElement, { attributes:true, attributeFilter:['data-tema', 'class'] });
});
