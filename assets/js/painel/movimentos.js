/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · MOVIMENTAÇÕES DO ERP (entradas e internos)

   As mesmas vistas em dois lugares:
     Hoje      abas "Entradas" e "Internos", de um dia (o último com
               movimento antes de hoje, ou o escolhido)
     Analista  abas "Entradas" e "Internos", do período escolhido

   Só o que veio do ERP (robô das movimentações, tabela erp_mov):
     Entrada           nota de entrada (compra, transferência entre
                       filiais, devolução…) e em qual armazém entrou
     Saída/Entrada     interna: transferência entre armazéns (98 → 42
       Interna         na liberação da quarentena, para D6, 91, D7…),
                       produção (entrada sem par) e consumo (saída sem
                       par), com o usuário que lançou

   Depende de: comum.js, saldo-erp.js (saUn, saData), analista.js
   (anTransferencias, anQ, anR, AN_UNS), inteligencia.js (iRota).
   ═══════════════════════════════════════════════════════════════ */

const _mv = {
  hj:{ ent:{ arm:'', tes:'', q:'' }, int:{ modo:'para', arm:'', usu:'', q:'' } },
  an:{ ent:{ arm:'', tes:'', q:'' }, int:{ modo:'para', arm:'', usu:'', q:'' } },
};
// Armazéns na ordem em que o galpão pensa: venda, faturamento, quarentena, o resto.
const MV_ORDEM = ['42', 'D2', '98', 'D6', '91', '94', 'D5', 'D4', 'D7', '48', '88', 'D8', '49', '85', 'CE'];
const mvOrdemArm = (a, b) => { const ia = MV_ORDEM.indexOf(a), ib = MV_ORDEM.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b)); };
const mvNomeArm = a => (typeof nomeArmazem === 'function' && nomeArmazem(a)) || '';
const mvArmTxt = a => a && a !== '—' ? `<b class="mono">${esc(a)}</b>${mvNomeArm(a) ? ` <span class="mv-armn">${esc(mvNomeArm(a).toLowerCase())}</span>` : ''}` : '<span class="num-zero">—</span>';
const mvQem = r => r.usuario || r.usuario_import || '';
const mvQtdTxt = q => [...AN_UNS, ...Object.keys(q).filter(u => !AN_UNS.includes(u))].filter(u => q[u]).map(u => `${anQ(q[u])} ${esc(u)}`).join(' · ') || '—';
function mvSomaUn(rows, qtd = r => Number(r.quantidade) || 0) {
  const q = {}; for (const r of rows) q[r.un || 'UN'] = (q[r.un || 'UN'] || 0) + qtd(r); return q;
}
const mvBusca = (q, ...v) => !q || v.some(x => String(x || '').toUpperCase().includes(q));
function mvSet(esc_, parte, campo, v, rerender) {
  const st = _mv[esc_][parte];
  st[campo] = st[campo] === v && campo !== 'q' && campo !== 'modo' ? '' : v;
  if (campo === 'modo') st.arm = '';
  if (rerender === 'an') renderAnalista(); else hjErpRender();
}
const mvSetAttr = (esc_, parte, campo, v, rr) => `mvSet('${esc_}','${parte}','${campo}','${String(v).replace(/'/g, "\\'")}','${rr}')`;
function mvBuscaInput(esc_, parte, rr, ph) {
  const st = _mv[esc_][parte];
  return `<input type="search" class="mv-busca" placeholder="${esc(ph)}" value="${esc(st.q)}" aria-label="Buscar"
    oninput="_mv['${esc_}']['${parte}'].q=this.value;clearTimeout(_mv.t);_mv.t=setTimeout(()=>{${rr === 'an' ? 'renderAnalista()' : 'hjErpRender()'};const e=document.querySelector('.mv-busca');if(e){e.focus();e.setSelectionRange(e.value.length,e.value.length);}},300)">`;
}

/* ═══════════ ENTRADAS ═══════════ */
function mvEntradas(rows, esc_, rr, titulo = 'Entradas') {
  const st = _mv[esc_].ent, q = st.q.trim().toUpperCase();
  const ent = rows.filter(r => r.tipo_mov === 'Entrada');
  const porArm = new Map(), porTes = new Map();
  for (const r of ent) { (porArm.get(r.arm) || porArm.set(r.arm, []).get(r.arm)).push(r); const t = r.tes_desc || '(sem TES)'; (porTes.get(t) || porTes.set(t, []).get(t)).push(r); }
  const f = ent.filter(r => (!st.arm || r.arm === st.arm) && (!st.tes || (r.tes_desc || '(sem TES)') === st.tes)
    && mvBusca(q, r.codigo, r.descricao, r.lote, r.nf, r.cli_nome, mvQem(r)));
  const nfs = new Set(f.map(r => `${r.filial}|${r.nf}|${r.serie}`));
  const fornec = new Set(f.map(r => r.cli_nome).filter(Boolean));
  const valor = f.reduce((a, r) => a + (Number(r.valor) || 0), 0);
  const ordem = [...f].sort((a, b) => String(b.emissao).localeCompare(String(a.emissao)) || String(a.nf).localeCompare(String(b.nf)) || String(a.descricao).localeCompare(String(b.descricao)));
  const p = fatiar(`mv-ent-${esc_}`, ordem, JSON.stringify(st) + ordem.length);
  const cartArm = [...porArm].sort((a, b) => mvOrdemArm(a[0], b[0])).map(([a, rs]) => `<button class="mv-cart${st.arm === a ? ' on' : ''}" onclick="${mvSetAttr(esc_, 'ent', 'arm', a, rr)}">
      <span class="mv-cart-t">Entrou no ${mvArmTxt(a)}</span><b>${num(new Set(rs.map(r => `${r.filial}|${r.nf}|${r.serie}`)).size)} nota(s) · ${num(rs.length)} item(ns)</b><small>${mvQtdTxt(mvSomaUn(rs))}</small></button>`).join('');
  const chipsTes = [...porTes].sort((a, b) => b[1].length - a[1].length).map(([t, rs]) => `<button class="mv-chip${st.tes === t ? ' on' : ''}" onclick="${mvSetAttr(esc_, 'ent', 'tes', t, rr)}">${esc(t)} <span>${num(rs.length)}</span></button>`).join('');
  if (!ent.length) return `<div class="panel"><div class="empty"><div class="empty-ico">◔</div><div class="empty-tit">Nenhuma nota de entrada</div><div class="empty-sub">${esc_ === 'hj' ? 'Neste dia o ERP não registrou entrada.' : 'Nenhuma entrada no período.'}</div></div></div>`;
  return `<div class="mv-carts">${cartArm}</div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">${esc(titulo)}</div>
      <div class="section-note">${num(nfs.size)} nota(s) · ${num(f.length)} item(ns) · ${num(fornec.size)} fornecedor(es) · ${mvQtdTxt(mvSomaUn(f))}${valor ? ` · ${anR(valor)}` : ''}</div></div>
      ${mvBuscaInput(esc_, 'ent', rr, 'Produto, lote, NF, fornecedor')}</div>
    <div class="mv-filtro"><span>Tipo (TES)</span><div class="mv-chips">${chipsTes}</div>${st.arm || st.tes || st.q ? `<button class="btn btn-sm btn-ghost" onclick="_mv['${esc_}'].ent={arm:'',tes:'',q:''};${rr === 'an' ? 'renderAnalista()' : 'hjErpRender()'}">Limpar filtros</button>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl mv-tbl"><thead><tr>${esc_ === 'an' ? '<th>Data</th>' : ''}<th>NF</th><th>Produto</th><th>Lote</th><th>Validade</th><th>Armazém</th><th class="num">Quantidade</th><th class="num">Paletes</th><th class="num">Valor</th><th>Fornecedor · TES</th><th>Quem lançou</th></tr></thead>
    <tbody>${p.itens.map(r => `<tr>${esc_ === 'an' ? `<td class="mono">${saData(String(r.emissao).slice(0, 10))}</td>` : ''}<td class="mono"><b>${esc(r.nf || '—')}</b>${r.serie ? `<div class="sub">série ${esc(r.serie)}</div>` : ''}</td>
      <td class="nome">${esc(r.descricao || r.codigo)}<div class="sub mono">${esc(r.codigo)}${r.tipo_prod ? ' · ' + esc(r.tipo_prod) : ''} · ${esc(filialCurta(r.filial))}</div></td>
      <td class="mono">${esc(r.lote || '—')}</td><td class="mono">${r.dt_validade ? saData(String(r.dt_validade).slice(0, 10)) : '—'}</td><td>${mvArmTxt(r.arm)}</td>
      <td class="num"><b>${anQ(r.quantidade)}</b> <small class="sa-un">${esc(r.un)}</small></td><td class="num">${Number(r.paletes) ? num1(typeof anPl === 'function' ? anPl(r) : r.paletes) : '—'}</td>
      <td class="num">${Number(r.valor) ? anR(r.valor) : '—'}</td><td><div class="mv-corta" title="${esc(r.cli_nome || '')}">${esc(r.cli_nome || '—')}</div><div class="sub mv-corta">${esc(r.tes_desc || '')}</div></td><td>${esc(mvQem(r) || '—')}</td></tr>`).join('')
      || `<tr><td colspan="11" class="num-zero">Nada com esses filtros.</td></tr>`}</tbody></table></div>
    ${barraPag(`mv-ent-${esc_}`, p, 'item(ns)')}</div>`;
}

/* ═══════════ INTERNOS ═══════════ */
function mvRotaTxt(t) {
  if (!t.s) return 'produção / entrada';
  if (!t.e) return 'consumo / saída';
  return t.rota;
}
function mvInternos(rows, esc_, rr, titulo = 'Movimentos internos') {
  const st = _mv[esc_].int, q = st.q.trim().toUpperCase();
  const tr = anTransferencias(rows);
  for (const t of tr) { t.qem = t.usuario || mvQem(t.s || {}) || mvQem(t.e || {}); t.val = (t.s || t.e)?.dt_validade; }
  if (!tr.length) return `<div class="panel"><div class="empty"><div class="empty-ico">⇄</div><div class="empty-tit">Nenhum movimento interno</div><div class="empty-sub">${esc_ === 'hj' ? 'Neste dia o ERP não registrou transferência entre armazéns.' : 'Nada no período.'}</div></div></div>`;
  const lado = t => st.modo === 'de' ? t.de : t.para;
  const porArm = new Map();
  for (const t of tr) { const a = lado(t); (porArm.get(a) || porArm.set(a, []).get(a)).push(t); }
  const usus = new Map();
  for (const t of tr) { const u = t.qem || '(sem usuário)'; (usus.get(u) || usus.set(u, []).get(u)).push(t); }
  const f = tr.filter(t => (!st.arm || lado(t) === st.arm) && (!st.usu || (t.qem || '(sem usuário)') === st.usu)
    && mvBusca(q, t.base.codigo, t.base.descricao, t.base.lote, t.doc, t.qem, t.de, t.para));
  const p = fatiar(`mv-int-${esc_}`, f, JSON.stringify(st) + f.length);
  const verbo = st.modo === 'de' ? 'Saiu do' : 'Foi para o';
  const cart = [...porArm].sort((a, b) => mvOrdemArm(a[0], b[0])).map(([a, ts]) => {
    const rotas = {}; for (const t of ts) { const k = mvRotaTxt(t); rotas[k] = (rotas[k] || 0) + 1; }
    return `<button class="mv-cart${st.arm === a ? ' on' : ''}" onclick="${mvSetAttr(esc_, 'int', 'arm', a, rr)}">
      <span class="mv-cart-t">${a === '—' ? (st.modo === 'de' ? 'Sem origem (produção)' : 'Sem destino (consumo)') : `${verbo} ${mvArmTxt(a)}`}</span>
      <b>${num(ts.length)} movimento(s)</b><small>${mvQtdTxt(mvSomaUn(ts.map(t => t.base)))}</small>
      <small class="mv-cart-r">${Object.entries(rotas).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${esc(k)} ${n}`).join(' · ')}</small></button>`; }).join('');
  const chipsUsu = [...usus].sort((a, b) => b[1].length - a[1].length).map(([u, ts]) => { const r = {}; for (const t of ts) { const k = mvRotaTxt(t); r[k] = (r[k] || 0) + 1; }
    return `<button class="mv-chip${st.usu === u ? ' on' : ''}" title="${esc(Object.entries(r).map(([k, n]) => `${k}: ${n}`).join(' · '))}" onclick="${mvSetAttr(esc_, 'int', 'usu', u, rr)}">${esc(u)} <span>${num(ts.length)}</span></button>`; }).join('');
  return `<div class="mv-modo"><div class="seg"><button class="${st.modo === 'para' ? 'active' : ''}" onclick="${mvSetAttr(esc_, 'int', 'modo', 'para', rr)}">Por armazém de destino</button><button class="${st.modo === 'de' ? 'active' : ''}" onclick="${mvSetAttr(esc_, 'int', 'modo', 'de', rr)}">Por armazém de origem</button></div></div>
  <div class="mv-carts">${cart}</div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">${esc(titulo)}</div>
      <div class="section-note">${num(f.length)} movimento(s) · ${mvQtdTxt(mvSomaUn(f.map(t => t.base)))}${st.arm ? ` · ${st.modo === 'de' ? 'saindo do' : 'indo para o'} ${esc(st.arm)}` : ''}</div></div>
      ${mvBuscaInput(esc_, 'int', rr, 'Produto, lote, documento, usuário')}</div>
    <div class="mv-filtro"><span>Quem movimentou</span><div class="mv-chips">${chipsUsu}</div>${st.arm || st.usu || st.q ? `<button class="btn btn-sm btn-ghost" onclick="_mv['${esc_}'].int={modo:'${st.modo}',arm:'',usu:'',q:''};${rr === 'an' ? 'renderAnalista()' : 'hjErpRender()'}">Limpar filtros</button>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl mv-tbl"><thead><tr>${esc_ === 'an' ? '<th>Data</th>' : ''}<th>O quê</th><th>Produto</th><th>Lote</th><th>De</th><th>Para</th><th class="num">Quantidade</th><th>Doc.</th><th>Quem</th></tr></thead>
    <tbody>${p.itens.map(t => `<tr>${esc_ === 'an' ? `<td class="mono">${saData(String(t.emissao).slice(0, 10))}</td>` : ''}<td><span class="tag ${/quarentena/.test(t.rota) ? 't-ok' : /vencido|descarte|avaria/.test(t.rota) ? 't-neg' : !t.s || !t.e ? 't-info' : 't-mute'}">${esc(mvRotaTxt(t))}</span></td>
      <td class="nome">${esc(t.base.descricao || t.base.codigo)}${t.codDif ? `<div class="sub">vira ${esc(t.e.descricao || t.e.codigo)}</div>` : ''}<div class="sub mono">${esc(t.base.codigo)} · ${esc(filialCurta(t.base.filial))}</div></td>
      <td class="mono">${esc(t.base.lote || '—')}${t.val ? `<div class="sub">val. ${saData(String(t.val).slice(0, 10))}</div>` : ''}</td>
      <td>${mvArmTxt(t.de)}</td><td>${mvArmTxt(t.para)}</td>
      <td class="num"><b>${anQ(t.qtd)}</b> <small class="sa-un">${esc(t.un)}</small></td><td class="mono">${esc(t.doc || '—')}</td><td>${esc(t.qem || '—')}</td></tr>`).join('')
      || `<tr><td colspan="9" class="num-zero">Nada com esses filtros.</td></tr>`}</tbody></table></div>
    ${barraPag(`mv-int-${esc_}`, p, 'movimento(s)')}</div>`;
}

/* ═══════════ HOJE: abas Entradas e Internos (um dia) ═══════════ */
const _hjErp = { dia:null, rows:null, dias:[], erro:null, carregando:null, quando:0 };
async function hjErpCarregar(forcar = false) {
  const el = $('hj-erp'); if (!el) return;
  if (_hjErp.carregando) return _hjErp.carregando;
  if (!forcar && _hjErp.rows && Date.now() - _hjErp.quando < 120000) { hjErpRender(); return; }
  if (!_hjErp.rows) el.innerHTML = '<div class="skeleton">buscando as movimentações do ERP…</div>';
  _hjErp.carregando = (async () => {
    try {
      const hoje = boIso(new Date()), ini = new Date(); ini.setDate(ini.getDate() - 35);
      // Uma ida ao banco: os dias com entrada ou movimento interno (para o seletor) e o dia aberto.
      const rows = await buscarTudo(() => sb.from('erp_mov').select('*')
        .in('tipo_mov', ['Entrada', 'Entrada Interna', 'Saída Interna']).gte('emissao', boIso(ini)).lte('emissao', hoje).order('emissao').order('id'));
      const ok = rows.filter(r => r.movest !== false && (typeof daFilial !== 'function' || daFilial(r.filial)));
      for (const r of ok) { r.un = typeof saUn === 'function' ? saUn(r.um) : String(r.um || '').toUpperCase(); r.arm = normalizarArmazem(r.armazem); }
      _hjErp.todas = ok;
      _hjErp.dias = [...new Set(ok.map(r => String(r.emissao).slice(0, 10)))].sort();
      if (!_hjErp.dia) _hjErp.dia = [..._hjErp.dias].reverse().find(d => d < hoje) || _hjErp.dias.at(-1) || boIso(new Date(Date.now() - 864e5));
      const { data } = await sb.from('erp_mov_sync').select('quando').order('quando', { ascending:false }).limit(1).maybeSingle();
      _hjErp.sync = data?.quando || null;
      _hjErp.erro = null; _hjErp.quando = Date.now();
    } catch (e) { _hjErp.erro = e; }
  })();
  try { await _hjErp.carregando; } finally { _hjErp.carregando = null; }
  hjErpRender();
}
function hjErpDia(iso) { if (!iso) return; _hjErp.dia = iso; hjErpRender(); }
function hjErpRender() {
  const el = $('hj-erp'); if (!el || el.hidden) return;
  if (_hjErp.erro) { el.innerHTML = `<div class="aviso a-warn"><span class="aviso-ico">!</span><div><b>As movimentações do ERP não chegaram</b> Rode o <code>sql/migracao-movimentos.sql</code> e instale o robô das movimentações. (${esc(_hjErp.erro.message || _hjErp.erro)})</div></div>`; return; }
  if (!_hjErp.todas) return;
  const dia = _hjErp.dia, rows = _hjErp.todas.filter(r => String(r.emissao).slice(0, 10) === dia);
  const ds = _hjErp.dias, i = ds.indexOf(dia), hoje = boIso(new Date());
  const ant = i > 0 ? ds[i - 1] : ds.filter(d => d < dia).at(-1), prox = i >= 0 ? ds[i + 1] : ds.find(d => d > dia);
  const nEnt = rows.filter(r => r.tipo_mov === 'Entrada').length, nInt = anTransferencias(rows).length;
  const cab = `<div class="bo-ctrl mv-dia">
    <div class="bo-dia mv">
      <button class="btn btn-sm" onclick="hjErpDia('${ant || ''}')" ${ant ? '' : 'disabled'} title="Dia anterior com movimento" aria-label="Dia anterior">‹</button>
      <input type="date" class="bo-data" value="${dia}" max="${hoje}" onchange="hjErpDia(this.value)" aria-label="Dia">
      <button class="btn btn-sm" onclick="hjErpDia('${prox || ''}')" ${prox ? '' : 'disabled'} title="Próximo dia com movimento" aria-label="Próximo dia">›</button>
      <span class="mv-dia-t"><b>${esc(boDiaLongo(dia))}</b>${dia === hoje ? ' · hoje (o robô manda às 07:00 e 12:00)' : ''}</span>
    </div>
    <div class="mv-dia-n">${num(nEnt)} entrada(s) · ${num(nInt)} movimento(s) interno(s)${_hjErp.sync ? ` · ERP até ${esc(fmtTS(_hjErp.sync))}` : ''}</div>
  </div>`;
  el.innerHTML = cab + (_bo.aba === 'internos' ? mvInternos(rows, 'hj', 'hj', 'Movimentos internos do dia') : mvEntradas(rows, 'hj', 'hj', 'Entradas do dia'));
}
