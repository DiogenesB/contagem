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

   Em cada lote: fabricação e validade (a fabricação vem do saldo do
   ERP, estoque_ref, porque o relatório de movimentos não traz), se o
   lote já teve outra liberação da quarentena, e o histórico completo
   do lote (clique no lote).

   Depende de: comum.js, saldo-erp.js (saUn, saData), analista.js
   (anTransferencias, anQ, anR, AN_UNS), inteligencia.js (iRota).
   ═══════════════════════════════════════════════════════════════ */

const _mv = {
  hj:{ ent:{ arm:'', tes:'', q:'' }, int:{ modo:'todas', arm:'', usu:'', q:'' } },
  an:{ ent:{ arm:'', tes:'', q:'' }, int:{ modo:'todas', arm:'', usu:'', q:'' } },
};
// Armazéns na ordem em que o galpão pensa: venda, faturamento, quarentena, o resto.
const MV_ORDEM = ['42', 'D2', '98', 'D6', '91', '94', 'D5', 'D4', 'D7', '48', '88', 'D8', '49', '85', 'CE'];
const mvOrdemArm = (a, b) => { const ia = MV_ORDEM.indexOf(a), ib = MV_ORDEM.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b)); };
const mvNomeArm = a => (typeof nomeArmazem === 'function' && nomeArmazem(a)) || '';
const mvArmTxt = a => a && a !== '—' ? `<b class="mono">${esc(a)}</b>${mvNomeArm(a) ? ` <span class="mv-armn">${esc(mvNomeArm(a).toLowerCase())}</span>` : ''}` : '<span class="num-zero">—</span>';
// De → para numa célula só: códigos em cima, nomes embaixo.
function mvDePara(de, para, nota = '') {
  const c = a => a === 'nota' ? '<span class="mv-nota">nota</span>' : a && a !== '—' ? `<b class="mono">${esc(a)}</b>` : '<span class="num-zero">—</span>';
  const n = (a, vazio) => a === 'nota' ? esc(nota || 'nota fiscal') : a && a !== '—' ? esc(mvNomeArm(a).toLowerCase() || a) : vazio;
  return `<div class="mv-dp">${c(de)} <span class="mv-seta">→</span> ${c(para)}</div><div class="sub mv-dp-n">${n(de, 'produção')} → ${n(para, 'consumo')}</div>`;
}
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

/* ═══════════ LOTE: fabricação, validade, liberações e histórico ═══════════ */
const _mvLote = new Map();        // codigo|lote → { fab, val, movs, libs, saldo }
const _mvLotePedido = new Set();  // já pedidos ao banco (não pede de novo)
const mvLk = (cod, lote) => `${normalizarCodigo(cod)}|${String(lote || '').trim().toUpperCase()}`;
const mvLoteInfo = (cod, lote) => _mvLote.get(mvLk(cod, lote));
const mvDia = d => d ? saData(String(d).slice(0, 10)) : '';
const mvDiaCurto = d => d ? saData(String(d).slice(0, 10)).slice(0, 5) : '';
const MV_LIB = 'liberação da quarentena';
const mvNormaliza = r => { r.un = typeof saUn === 'function' ? saUn(r.um) : String(r.um || '').toUpperCase(); r.arm = normalizarArmazem(r.armazem); return r; };

// Busca de uma vez os lotes que estão na tela: todos os movimentos deles
// (qualquer data) e o saldo atual (fabricação e validade). Depois redesenha.
async function mvLoteBuscar(pares, redesenhar) {
  const falta = pares.filter(([c, l]) => c && l && !_mvLotePedido.has(mvLk(c, l)));
  if (!falta.length) return;
  falta.forEach(([c, l]) => _mvLotePedido.add(mvLk(c, l)));
  const lotes = [...new Set(falta.map(([, l]) => String(l).trim().toUpperCase()))];
  try {
    const movs = [];
    for (let i = 0; i < lotes.length; i += 80) {
      const fatia = lotes.slice(i, i + 80);
      movs.push(...await buscarTudo(() => sb.from('erp_mov').select('*').in('lote', fatia).order('emissao').order('id')));
    }
    let ref = [];
    try {
      const r = await sb.from('estoque_ref').select('codigo, lote, armazem, filial, saldo, unidade, dt_fabricacao, dt_validade').in('lote', lotes);
      if (!r.error) ref = r.data || [];
    } catch (e) {}
    // Fabricação/validade que o saldo já mostrou para o lote ao longo do tempo
    // (sql/migracao-lote-fabval.sql; sem a tabela, fica só a de hoje).
    let fvs = [];
    try {
      const r = await sb.from('lote_fabval').select('codigo, lote, filial, dt_fabricacao, dt_validade, primeiro_visto, ultimo_visto').in('lote', lotes).order('primeiro_visto');
      if (!r.error) fvs = r.data || [];
    } catch (e) {}
    for (const r of movs) mvNormaliza(r);
    for (const [c, l] of falta) {
      const cod = normalizarCodigo(c), lt = String(l).trim().toUpperCase();
      const doLote = movs.filter(r => String(r.lote || '').toUpperCase() === lt && r.movest !== false);
      // Os do produto, e o outro lado das transferências dele (o fracionamento muda o código).
      const seqs = new Set(doLote.filter(r => normalizarCodigo(r.codigo) === cod && r.sequencia).map(r => `${r.filial}|${r.sequencia}`));
      const meus = doLote.filter(r => normalizarCodigo(r.codigo) === cod || seqs.has(`${r.filial}|${r.sequencia}`));
      const saldo = ref.filter(r => normalizarCodigo(r.codigo) === cod && String(r.lote || '').toUpperCase() === lt);
      const fab = saldo.map(r => r.dt_fabricacao).find(Boolean) || null;
      const val = saldo.map(r => r.dt_validade).find(Boolean) || meus.map(r => r.dt_validade).find(Boolean) || null;
      const libs = anTransferencias(meus).filter(t => t.rota === MV_LIB).sort((a, b) => String(a.emissao).localeCompare(String(b.emissao)));
      const fv = fvs.filter(r => normalizarCodigo(r.codigo) === cod && String(r.lote || '').toUpperCase() === lt);
      _mvLote.set(mvLk(c, l), { fab, val, movs:meus, libs, saldo, fv });
    }
  } catch (e) {
    falta.forEach(([c, l]) => _mvLotePedido.delete(mvLk(c, l)));
    return;
  }
  if (redesenhar === 'an') renderAnalista(); else if (redesenhar === 'hj') hjErpRender();
}
// Depois de desenhar a tabela, busca o que falta dos lotes da página.
function mvLoteDepois(pares, rr) { setTimeout(() => mvLoteBuscar(pares, rr), 0); }

// Fabricação e validade do lote NO DIA do movimento (podem mudar de uma
// liberação para outra). Ordem de confiança:
//   1. o que veio no próprio movimento (validade sempre; fabricação se a
//      consulta do ERP tiver a coluna)
//   2. a combinação fabricação+validade que o saldo mostrou com essa mesma
//      validade, ou a que valia naquele dia (lote_fabval)
//   3. a de hoje no saldo — marcada como aproximada
const mvIsoDe = ts => { const d = new Date(ts); return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mvD10 = x => x ? String(x).slice(0, 10) : null;
function mvFvDia(i, dia, rFab, rVal) {
  const d = mvD10(dia) || '9999-12-31', fv = i?.fv || [];
  let par = null, aprox = false;
  if (rVal) {
    const m = fv.filter(x => mvD10(x.dt_validade) === mvD10(rVal));
    par = m.filter(x => mvIsoDe(x.primeiro_visto) <= d).at(-1) || m[0] || null;
  }
  if (!par && fv.length) {
    par = fv.filter(x => mvIsoDe(x.primeiro_visto) <= d && mvIsoDe(x.ultimo_visto) >= d).at(-1)
       || fv.filter(x => mvIsoDe(x.primeiro_visto) <= d).at(-1) || null;
    if (!par) { par = fv[0]; aprox = true; }
  }
  if (!par && i) { par = { dt_fabricacao:i.fab, dt_validade:i.val }; aprox = true; }
  return {
    fab:rFab || par?.dt_fabricacao || null, val:rVal || par?.dt_validade || null,
    fabAprox:!rFab && aprox, valAprox:!rVal && aprox,
  };
}
const mvVenceCls = val => { if (!val) return ''; const d = Math.round((new Date(mvD10(val) + 'T12:00') - Date.now()) / 864e5); return d < 0 ? 'mv-venc' : d <= 90 ? 'mv-quase' : ''; };
// Fabricação e validade numa célula só (validade vencendo em vermelho/amarelo).
function mvFabVal(cod, lote, valMov, dia, fabMov) {
  const i = mvLoteInfo(cod, lote);
  const x = mvFvDia(i, dia, fabMov, valMov);
  const ap = 'title="Não veio no movimento: é a do saldo do ERP de hoje, pode ter sido outra naquele dia"';
  return `<div class="mv-fv${x.fabAprox ? ' mv-aprox' : ''}" ${x.fabAprox ? ap : ''}><span>fab.</span> ${x.fab ? mvDia(x.fab) : (i ? '—' : '…')}</div>` +
    `<div class="mv-fv ${x.valAprox ? 'mv-aprox' : mvVenceCls(x.val)}" ${x.valAprox ? ap : ''}><span>val.</span> ${x.val ? mvDia(x.val) : '—'}</div>`;
}
const mvLoteBt = (cod, lote) => lote
  ? `<button class="mv-lote" title="Histórico do lote" onclick="mvHistLote('${esc(normalizarCodigo(cod))}','${esc(String(lote).replace(/'/g, ''))}')">${esc(lote)}</button>`
  : '—';

// Outras liberações do mesmo lote (fora a deste movimento).
function mvLibTxt(t) {
  const i = mvLoteInfo(t.base.codigo, t.base.lote); if (!i) return '';
  const eu = `${t.base.filial}|${t.base.sequencia}`;
  const outras = i.libs.filter(x => `${x.base.filial}|${x.base.sequencia}` !== eu);
  const sou = t.rota === MV_LIB;
  if (!outras.length) return sou ? '<div class="mv-lib mv-lib-1">1ª liberação do lote</div>' : '';
  const ult = outras.slice(-2).map(x => `${mvDiaCurto(x.emissao)} (${anQ(x.qtd)} ${esc(x.un)})`).join(', ');
  return `<div class="mv-lib" title="${esc(outras.map(x => `${mvDia(x.emissao)}: ${anQ(x.qtd)} ${x.un} · ${x.doc || ''} · ${x.usuario || ''}`).join('\n'))}">${sou ? (outras.length === 1 ? 'outra liberação do lote' : `outras ${outras.length} liberações do lote`) : `lote liberado ${outras.length}×`}: ${ult}${outras.length > 2 ? ' …' : ''}</div>`;
}

/* ── Janela do histórico do lote ── */
function mvModalLote() {
  let m = $('modal-lote');
  if (m) return m;
  m = document.createElement('div');
  m.className = 'modal-bg'; m.id = 'modal-lote';
  m.onclick = e => { if (e.target === m) fecharModal('modal-lote'); };
  m.innerHTML = `<div class="modal wide mv-modal" role="dialog" aria-modal="true" aria-labelledby="ml-tit">
    <div class="modal-head"><div class="modal-title" id="ml-tit">Histórico do lote</div><div class="modal-sub" id="ml-sub"></div></div>
    <div class="modal-body flush" id="ml-corpo"></div>
    <div class="modal-foot"><button class="btn btn-ghost btn-sm" onclick="fecharModal('modal-lote')">Fechar</button></div></div>`;
  document.body.appendChild(m);
  return m;
}
async function mvHistLote(cod, lote) {
  mvModalLote(); abrirModal('modal-lote');
  $('ml-tit').textContent = `Lote ${lote}`;
  $('ml-sub').textContent = cod;
  $('ml-corpo').innerHTML = '<div class="skeleton" style="margin:20px">buscando tudo o que aconteceu com o lote…</div>';
  if (!mvLoteInfo(cod, lote)) { _mvLotePedido.delete(mvLk(cod, lote)); await mvLoteBuscar([[cod, lote]], null); }
  const i = mvLoteInfo(cod, lote);
  if (!i) { $('ml-corpo').innerHTML = '<div class="aviso a-warn" style="margin:20px"><span class="aviso-ico">!</span><div>Não consegui buscar o lote agora. Tente de novo.</div></div>'; return; }
  // Liberações de outros lotes do mesmo produto (180 dias).
  let outrosLotes = [];
  try {
    const desde = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
    const rs = await buscarTudo(() => sb.from('erp_mov').select('*').eq('codigo', normalizarCodigo(cod)).in('tipo_mov', ['Saída Interna', 'Entrada Interna']).gte('emissao', desde).order('emissao').order('id'));
    rs.forEach(mvNormaliza);
    outrosLotes = anTransferencias(rs.filter(r => r.movest !== false)).filter(t => t.rota === MV_LIB && String(t.base.lote || '').toUpperCase() !== String(lote).toUpperCase());
  } catch (e) {}
  outrosLotes = outrosLotes.slice(-30);
  if (outrosLotes.length) await mvLoteBuscar(outrosLotes.map(t => [t.base.codigo, t.base.lote]), null);
  const prod = i.movs.find(r => normalizarCodigo(r.codigo) === normalizarCodigo(cod)) || i.movs[0];
  $('ml-tit').textContent = `${prod?.descricao || cod} · lote ${lote}`;
  $('ml-sub').textContent = `${cod}${prod ? ' · ' + filialCurta(prod.filial) : ''}`;
  // Linha do tempo: notas uma a uma, internos em pares.
  const ev = [];
  for (const r of i.movs) if (r.tipo_mov === 'Entrada' || r.tipo_mov === 'Saída') ev.push({ d:r.emissao, id:r.id, r, t:null });
  for (const t of anTransferencias(i.movs)) ev.push({ d:t.emissao, id:(t.s || t.e).id, r:null, t });
  ev.sort((a, b) => String(a.d).localeCompare(String(b.d)) || a.id - b.id);
  const soma = f => mvQtdTxt(mvSomaUn(i.movs.filter(f)));
  // Fabricação/validade de cada movimento, no dia dele.
  const fvCel = (rr, dia) => { const x = rr || {}; return `<td class="mono">${mvFabVal(cod, lote, x.dt_validade, dia, x.dt_fabricacao)}</td>`; };
  const fvEv = e => e.r ? mvFvDia(i, e.r.emissao, e.r.dt_fabricacao, e.r.dt_validade) : mvFvDia(i, e.t.emissao, (e.t.e || e.t.s).dt_fabricacao, (e.t.s || e.t.e).dt_validade);
  const fvs = ev.map(fvEv);
  const difs = k => [...new Set(fvs.filter(x => x[k] && !x[k + 'Aprox']).map(x => mvD10(x[k])))].sort();
  const fabs = difs('fab'), vals = difs('val');
  const outrasTxt = (lista, atual) => { const o = lista.filter(x => x !== mvD10(atual)); return o.length ? `<small class="mv-ml-mudou">mudou: também ${o.map(mvDia).join(', ')}</small>` : ''; };
  const un = prod?.un || '';
  const vd = i.val ? Math.round((new Date(String(i.val).slice(0, 10) + 'T12:00') - Date.now()) / 864e5) : null;
  const saldoTxt = i.saldo.filter(r => Number(r.saldo)).sort((a, b) => mvOrdemArm(normalizarArmazem(a.armazem), normalizarArmazem(b.armazem)))
    .map(r => `<b class="mono">${esc(normalizarArmazem(r.armazem))}</b> ${anQ(r.saldo)} ${esc(typeof saUn === 'function' ? saUn(r.unidade) : r.unidade || un)}`).join(' · ') || 'sem saldo no ERP';
  const linha = e => {
    if (e.r) {
      const r = e.r, ent = r.tipo_mov === 'Entrada';
      return `<tr><td class="mono">${mvDia(r.emissao)}</td><td><span class="tag ${ent ? 't-info' : 't-mute'}">${ent ? 'entrada NF' : 'saída NF'}</span><div class="sub">${esc((r.tes_desc || '').toLowerCase())}</div></td>
        <td>${ent ? mvDePara('nota', r.arm, r.cli_nome ? 'fornecedor' : '') : mvDePara(r.arm, 'nota', r.cli_nome ? 'cliente' : '')}</td><td class="num"><b>${anQ(r.quantidade)}</b> <small class="sa-un">${esc(r.un)}</small></td>
        ${fvCel(r, r.emissao)}<td class="mono">${esc(r.nf || '—')}${r.pedido ? `<div class="sub">ped. ${esc(r.pedido)}</div>` : ''}</td><td><div class="mv-corta">${esc(r.cli_nome || '—')}</div>${r.cli_uf ? `<div class="sub">${esc(r.cli_uf)}</div>` : ''}</td><td>${esc(mvQem(r) || '—')}</td></tr>`;
    }
    const t = e.t;
    return `<tr class="${t.rota === MV_LIB ? 'mv-tl-lib' : ''}"><td class="mono">${mvDia(t.emissao)}</td><td><span class="tag ${t.rota === MV_LIB ? 't-ok' : /vencido|descarte|avaria/.test(t.rota) ? 't-neg' : !t.s || !t.e ? 't-info' : 't-mute'}">${esc(mvRotaTxt(t))}</span>${t.codDif ? `<div class="sub">vira ${esc(t.e.codigo)}</div>` : ''}</td>
      <td>${mvDePara(t.de, t.para)}</td><td class="num"><b>${anQ(t.qtd)}</b> <small class="sa-un">${esc(t.un)}</small></td>
      ${fvCel({ dt_validade:(t.s || t.e).dt_validade, dt_fabricacao:(t.e || t.s).dt_fabricacao }, t.emissao)}<td class="mono">${esc(t.doc || '—')}</td><td class="num-zero">—</td><td>${esc(t.usuario || mvQem(t.base) || '—')}</td></tr>`;
  };
  $('ml-corpo').innerHTML = `<div class="mv-ml-kpis">
      <div><span>Fabricação hoje</span><b>${i.fab ? mvDia(i.fab) : '—'}</b>${outrasTxt(fabs, i.fab)}</div>
      <div><span>Validade hoje</span><b class="${vd != null && vd < 0 ? 'mv-venc' : vd != null && vd <= 90 ? 'mv-quase' : ''}">${i.val ? mvDia(i.val) : '—'}</b>${vd != null ? `<small>${vd < 0 ? `vencido há ${num(-vd)} dia(s)` : `faltam ${num(vd)} dia(s)`}</small>` : ''}${outrasTxt(vals, i.val)}</div>
      <div><span>Liberações da quarentena</span><b>${num(i.libs.length)}</b>${i.libs.length ? `<small>${i.libs.map(x => mvDiaCurto(x.emissao)).join(' · ')}</small>` : ''}</div>
      <div><span>Entrou por nota</span><b>${soma(r => r.tipo_mov === 'Entrada')}</b></div>
      <div><span>Saiu por nota</span><b>${soma(r => r.tipo_mov === 'Saída')}</b></div>
      <div class="mv-ml-saldo"><span>Saldo hoje no ERP</span><b>${saldoTxt}</b></div>
    </div>
    <div class="mv-ml-sec">Tudo o que o ERP registrou deste lote <small>${num(ev.length)} movimento(s), do mais antigo ao mais novo · fabricação e validade de cada dia${fvs.some(x => x.fabAprox || x.valAprox) ? ' · <i class="mv-aprox">em cinza: a de hoje, o dia não tem registro</i>' : ''}</small></div>
    <div class="tbl-wrap"><table class="tbl mv-tbl"><thead><tr><th>Data</th><th>Movimento</th><th>Armazém</th><th class="num">Quantidade</th><th>Fabricação / validade</th><th>Doc. / NF</th><th>Cliente / fornecedor</th><th>Quem</th></tr></thead>
      <tbody>${ev.map(linha).join('') || '<tr><td colspan="8" class="num-zero">O ERP não tem movimento deste lote.</td></tr>'}</tbody></table></div>
    <div class="mv-ml-sec">Outras liberações deste produto <small>outros lotes, últimos 180 dias</small></div>
    ${outrosLotes.length ? `<div class="tbl-wrap"><table class="tbl mv-tbl"><thead><tr><th>Data</th><th>Lote</th><th>Fabricação / validade</th><th class="num">Quantidade</th><th>Doc.</th><th>Quem</th></tr></thead>
      <tbody>${outrosLotes.reverse().map(t => `<tr><td class="mono">${mvDia(t.emissao)}</td><td>${mvLoteBt(t.base.codigo, t.base.lote)}</td><td class="mono">${mvFabVal(t.base.codigo, t.base.lote, (t.s || t.e).dt_validade, t.emissao, (t.e || t.s).dt_fabricacao)}</td><td class="num"><b>${anQ(t.qtd)}</b> <small class="sa-un">${esc(t.un)}</small></td><td class="mono">${esc(t.doc || '—')}</td><td>${esc(t.usuario || '—')}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="hj-vazio" style="padding:4px 20px 18px">Nenhuma outra liberação deste produto nos últimos 180 dias.</div>'}`;
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
    <div class="tbl-wrap"><table class="tbl mv-tbl"><thead><tr>${esc_ === 'an' ? '<th>Data</th>' : ''}<th>NF</th><th>Produto</th><th>Lote</th><th>Fabricação / validade</th><th>Armazém</th><th class="num">Quantidade</th><th class="num">Paletes</th><th class="num">Valor</th><th>Fornecedor · TES</th><th>Quem lançou</th></tr></thead>
    <tbody>${p.itens.map(r => `<tr>${esc_ === 'an' ? `<td class="mono">${saData(String(r.emissao).slice(0, 10))}</td>` : ''}<td class="mono"><b>${esc(r.nf || '—')}</b>${r.serie ? `<div class="sub">série ${esc(r.serie)}</div>` : ''}</td>
      <td class="nome">${esc(r.descricao || r.codigo)}<div class="sub mono">${esc(r.codigo)}${r.tipo_prod ? ' · ' + esc(r.tipo_prod) : ''} · ${esc(filialCurta(r.filial))}</div></td>
      <td>${mvLoteBt(r.codigo, r.lote)}</td><td class="mono">${mvFabVal(r.codigo, r.lote, r.dt_validade, r.emissao, r.dt_fabricacao)}</td><td>${mvArmTxt(r.arm)}</td>
      <td class="num"><b>${anQ(r.quantidade)}</b> <small class="sa-un">${esc(r.un)}</small></td><td class="num">${Number(r.paletes) ? num1(typeof anPl === 'function' ? anPl(r) : r.paletes) : '—'}</td>
      <td class="num">${Number(r.valor) ? anR(r.valor) : '—'}</td><td><div class="mv-corta" title="${esc(r.cli_nome || '')}">${esc(r.cli_nome || '—')}</div><div class="sub mv-corta">${esc(r.tes_desc || '')}</div></td><td>${esc(mvQem(r) || '—')}</td></tr>`).join('')
      || `<tr><td colspan="11" class="num-zero">Nada com esses filtros.</td></tr>`}</tbody></table></div>
    ${barraPag(`mv-ent-${esc_}`, p, 'item(ns)')}</div>${(mvLoteDepois(p.itens.map(r => [r.codigo, r.lote]), rr), '')}`;
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
  if (!['todas', 'entradas', 'saidas'].includes(st.modo)) st.modo = 'todas';
  const nE = tr.filter(t => t.e).length, nS = tr.filter(t => t.s).length;
  const base = st.modo === 'entradas' ? tr.filter(t => t.e) : st.modo === 'saidas' ? tr.filter(t => t.s) : tr;
  const lado = t => st.modo === 'saidas' ? t.de : t.para;
  const porArm = new Map();
  for (const t of base) { const a = lado(t); (porArm.get(a) || porArm.set(a, []).get(a)).push(t); }
  const usus = new Map();
  for (const t of base) { const u = t.qem || '(sem usuário)'; (usus.get(u) || usus.set(u, []).get(u)).push(t); }
  const f = base.filter(t => (!st.arm || lado(t) === st.arm) && (!st.usu || (t.qem || '(sem usuário)') === st.usu)
    && mvBusca(q, t.base.codigo, t.base.descricao, t.base.lote, t.doc, t.qem, t.de, t.para));
  const p = fatiar(`mv-int-${esc_}`, f, JSON.stringify(st) + f.length);
  const verbo = st.modo === 'saidas' ? 'Saiu do' : st.modo === 'entradas' ? 'Entrou no' : 'Foi para o';
  const cart = [...porArm].sort((a, b) => mvOrdemArm(a[0], b[0])).map(([a, ts]) => {
    const rotas = {}; for (const t of ts) { const k = mvRotaTxt(t); rotas[k] = (rotas[k] || 0) + 1; }
    return `<button class="mv-cart${st.arm === a ? ' on' : ''}" onclick="${mvSetAttr(esc_, 'int', 'arm', a, rr)}">
      <span class="mv-cart-t">${a === '—' ? (st.modo === 'saidas' ? 'Sem origem (produção)' : 'Sem destino (consumo)') : `${verbo} ${mvArmTxt(a)}`}</span>
      <b>${num(ts.length)} movimento(s)</b><small>${mvQtdTxt(mvSomaUn(ts.map(t => t.base)))}</small>
      <small class="mv-cart-r">${Object.entries(rotas).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${esc(k)} ${n}`).join(' · ')}</small></button>`; }).join('');
  const chipsUsu = [...usus].sort((a, b) => b[1].length - a[1].length).map(([u, ts]) => { const r = {}; for (const t of ts) { const k = mvRotaTxt(t); r[k] = (r[k] || 0) + 1; }
    return `<button class="mv-chip${st.usu === u ? ' on' : ''}" title="${esc(Object.entries(r).map(([k, n]) => `${k}: ${n}`).join(' · '))}" onclick="${mvSetAttr(esc_, 'int', 'usu', u, rr)}">${esc(u)} <span>${num(ts.length)}</span></button>`; }).join('');
  const bm = (m, rot, n) => `<button class="${st.modo === m ? 'active' : ''}" onclick="${mvSetAttr(esc_, 'int', 'modo', m, rr)}">${rot} <span class="mv-n">${num(n)}</span></button>`;
  return `<div class="mv-modo"><div class="seg" role="tablist" aria-label="Filtro dos movimentos internos">${bm('todas', 'Todas', tr.length)}${bm('entradas', 'Entradas internas', nE)}${bm('saidas', 'Saídas internas', nS)}</div>
    <span class="mv-modo-txt">${st.modo === 'entradas' ? 'o que entrou em cada armazém (transferência recebida ou produção)' : st.modo === 'saidas' ? 'o que saiu de cada armazém (transferência enviada ou consumo)' : 'cartões pelo armazém de destino'}</span></div>
  <div class="mv-carts">${cart}</div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">${esc(titulo)}</div>
      <div class="section-note">${num(f.length)} movimento(s) · ${mvQtdTxt(mvSomaUn(f.map(t => t.base)))}${st.arm ? ` · ${st.modo === 'saidas' ? 'saindo do' : 'indo para o'} ${esc(st.arm)}` : ''}</div></div>
      ${mvBuscaInput(esc_, 'int', rr, 'Produto, lote, documento, usuário')}</div>
    <div class="mv-filtro"><span>Quem movimentou</span><div class="mv-chips">${chipsUsu}</div>${st.arm || st.usu || st.q ? `<button class="btn btn-sm btn-ghost" onclick="_mv['${esc_}'].int={modo:'${st.modo}',arm:'',usu:'',q:''};${rr === 'an' ? 'renderAnalista()' : 'hjErpRender()'}">Limpar filtros</button>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl mv-tbl"><thead><tr><th>${esc_ === 'an' ? 'Data · o quê' : 'O quê'}</th><th>Produto</th><th>Lote</th><th>Fabricação / validade</th><th>De → para</th><th class="num">Quantidade</th><th>Doc.</th><th>Quem</th></tr></thead>
    <tbody>${p.itens.map(t => `<tr><td>${esc_ === 'an' ? `<div class="mono mv-data">${saData(String(t.emissao).slice(0, 10))}</div>` : ''}<span class="tag ${/quarentena/.test(t.rota) ? 't-ok' : /vencido|descarte|avaria/.test(t.rota) ? 't-neg' : !t.s || !t.e ? 't-info' : 't-mute'}">${esc(mvRotaTxt(t))}</span></td>
      <td class="nome">${esc(t.base.descricao || t.base.codigo)}${t.codDif ? `<div class="sub">vira ${esc(t.e.descricao || t.e.codigo)}</div>` : ''}<div class="sub mono">${esc(t.base.codigo)} · ${esc(filialCurta(t.base.filial))}</div></td>
      <td>${mvLoteBt(t.base.codigo, t.base.lote)}${mvLibTxt(t)}</td><td class="mono">${mvFabVal(t.base.codigo, t.base.lote, t.val, t.emissao, (t.e || t.s).dt_fabricacao)}</td>
      <td>${mvDePara(t.de, t.para)}</td>
      <td class="num"><b>${anQ(t.qtd)}</b> <small class="sa-un">${esc(t.un)}</small></td><td class="mono">${esc(t.doc || '—')}</td><td>${esc(t.qem || '—')}</td></tr>`).join('')
      || `<tr><td colspan="9" class="num-zero">Nada com esses filtros.</td></tr>`}</tbody></table></div>
    ${barraPag(`mv-int-${esc_}`, p, 'movimento(s)')}</div>${(mvLoteDepois(p.itens.map(t => [t.base.codigo, t.base.lote]), rr), '')}`;
}

/* ═══════════ HOJE: abas Entradas e Internos (um dia) ═══════════ */
const _hjErp = { dia:null, todas:null, dias:[], erro:null, carregando:null, quando:0 };
async function hjErpCarregar(forcar = false) {
  const el = $('hj-erp'); if (!el) return;
  if (_hjErp.carregando) return _hjErp.carregando;
  if (!forcar && _hjErp.todas && Date.now() - _hjErp.quando < 120000) { hjErpRender(); return; }
  if (!_hjErp.todas) el.innerHTML = '<div class="skeleton">buscando as movimentações do ERP…</div>';
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
      if (forcar) { _mvLote.clear(); _mvLotePedido.clear(); }
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
