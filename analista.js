/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · ANALISTA (movimentações do ERP)

   Lê a tabela erp_mov (robô das movimentações, 07:00 e 12:00) e
   mostra o período escolhido: notas faturadas, pedidos, clientes,
   volume por unidade, entradas, transferências internas, quem lançou
   e a cobertura do estoque (quantos dias o saldo dura no ritmo de
   saída — e o que vai vencer antes de sair).

   Litro, quilo e dose nunca se somam: cada unidade tem a sua coluna.
   ═══════════════════════════════════════════════════════════════ */

const _an = { rows:null, erro:null, sync:null, periodo:'30', aba:'resumo', un:'L', tipo:'', busca:'', tipoMov:'', carregado:0 };
const AN_PERIODOS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['mesant', 'Mês passado'], ['90', '90 dias']];
const AN_ABAS = [['resumo', 'Resumo'], ['saidas', 'Saídas'], ['clientes', 'Clientes'], ['entradas', 'Entradas'], ['internos', 'Internos'], ['cobertura', 'Cobertura'], ['lista', 'Movimentos']];
const AN_UNS = ['L', 'KG', 'DS'];
// Armazéns de onde o produto sai para venda (o resto é quarentena,
// retrabalho, avaria, vencido, descarte ou bloqueado).
const AN_ARM_FORA_VENDA = ['D7', '48', '88', '91', '94', 'D4', '98', 'D6'];

/* ═══════════ DATAS ═══════════ */
const anIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function anJanela(p) {
  const h = new Date(); h.setHours(0, 0, 0, 0);
  const menos = n => { const d = new Date(h); d.setDate(d.getDate() - n); return d; };
  if (p === 'hoje')   return { de:h, ate:h };
  if (p === 'ontem')  return { de:menos(1), ate:menos(1) };
  if (p === 'mes')    return { de:new Date(h.getFullYear(), h.getMonth(), 1), ate:h };
  if (p === 'mesant') return { de:new Date(h.getFullYear(), h.getMonth() - 1, 1), ate:new Date(h.getFullYear(), h.getMonth(), 0) };
  const n = Number(p) || 30;
  return { de:menos(n - 1), ate:h };
}
const anDias = (de, ate) => Math.round((ate - de) / 864e5) + 1;

/* ═══════════ CARGA ═══════════ */
async function carregarAnalista(forcar = false) {
  const corpo = $('an-corpo');
  if (!corpo) return;
  if (!_an.rows) corpo.innerHTML = '<div class="skeleton">carregando as movimentações…</div>';
  if (forcar || !_an.rows || Date.now() - _an.carregado > 5 * 60e3) {
    // Período maior entre: o escolhido + o anterior (comparação) e 30 dias (cobertura).
    const { de, ate } = anJanela(_an.periodo);
    const len = anDias(de, ate);
    const ini = new Date(Math.min(de.getTime() - len * 864e5, Date.now() - 31 * 864e5));
    try {
      const [rows, sync] = await Promise.all([
        buscarTudo(() => sb.from('erp_mov').select('*').gte('emissao', anIso(ini)).lte('emissao', anIso(ate)).order('emissao').order('id')),
        sb.from('erp_mov_sync').select('quando, de, ate, linhas, origem').order('quando', { ascending:false }).limit(1).maybeSingle(),
      ]);
      _an.rows = rows.filter(r => r.movest !== false);
      for (const r of _an.rows) { r.un = typeof saUn === 'function' ? saUn(r.um) : String(r.um || '').toUpperCase(); r.arm = normalizarArmazem(r.armazem); }
      _an.sync = sync.data || null;
      _an.erro = null;
      _an.ini = ini;
      _an.carregado = Date.now();
    } catch (e) { _an.erro = e; _an.rows = []; }
    // A cobertura precisa do saldo do ERP.
    if (typeof carregarSaldoErp === 'function' && !_sa?.ok) carregarSaldoErp(false).then(() => { if (_an.aba === 'cobertura' || _an.aba === 'resumo') renderAnalista(); }).catch(() => {});
  }
  renderAnalista();
}
function anPeriodo(p) { _an.periodo = p; _an.carregado = 0; carregarAnalista(true); }
function anAba(a) { _an.aba = a; renderAnalista(); }
function anSet(campo, v) { _an[campo] = v; renderAnalista(); }

// Linhas do período (e do período anterior, para comparar).
function anLinhas(anterior = false) {
  const { de, ate } = anJanela(_an.periodo);
  let a = de, b = ate;
  if (anterior) { const len = anDias(de, ate); b = new Date(de.getTime() - 864e5); a = new Date(b.getTime() - (len - 1) * 864e5); }
  const ia = anIso(a), ib = anIso(b);
  return (_an.rows || []).filter(r => {
    const d = String(r.emissao).slice(0, 10);
    return d >= ia && d <= ib && (typeof daFilial !== 'function' || daFilial(r.filial)) && (!_an.tipo || r.tipo_prod === _an.tipo);
  });
}

/* ═══════════ CONTAS ═══════════ */
const anNF = r => `${r.filial}|${r.nf || ''}|${r.serie || ''}`;
const anCli = r => r.cli_cod ? `${r.cli_cod}|${r.cli_loja || ''}` : (r.cli_nome || '');
function anSoma(ls) {
  const o = { linhas:ls.length, nfs:new Set(), peds:new Set(), clis:new Set(), q:{}, pl:0, valor:0 };
  for (const r of ls) {
    if (r.nf) o.nfs.add(anNF(r));
    if (r.pedido) o.peds.add(r.pedido);
    if (anCli(r)) o.clis.add(anCli(r));
    o.q[r.un] = (o.q[r.un] || 0) + (Number(r.quantidade) || 0);
    o.pl += Number(r.paletes) || 0;
    o.valor += Number(r.valor) || 0;
  }
  return o;
}
const anQ = n => num(Math.round((Number(n) || 0) * 100) / 100);
const anR = v => 'R$ ' + num(Math.round(Number(v) || 0));
const anUnsDe = o => [...new Set([...AN_UNS, ...Object.keys(o.q)])].filter(u => o.q[u]);
const anQtdTxt = o => anUnsDe(o).map(u => `${anQ(o.q[u])} ${esc(u)}`).join(' · ') || '—';
function anVar(a, b) {
  if (!b) return a ? '<span class="an-var">novo</span>' : '';
  const p = (a - b) / b * 100;
  if (Math.abs(p) < 0.5) return '<span class="an-var">igual ao período anterior</span>';
  return `<span class="an-var ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${num1(Math.abs(p))}% vs. período anterior</span>`;
}
// Saída interna + entrada interna da mesma sequência = uma transferência.
function anTransferencias(ls) {
  const porSeq = new Map();
  for (const r of ls) if ((r.tipo_mov === 'Saída Interna' || r.tipo_mov === 'Entrada Interna') && r.sequencia) {
    const k = `${r.filial}|${r.sequencia}`; (porSeq.get(k) || porSeq.set(k, []).get(k)).push(r);
  }
  const out = [];
  for (const g of porSeq.values()) {
    const s = g.find(r => r.tipo_mov === 'Saída Interna'), e = g.find(r => r.tipo_mov === 'Entrada Interna');
    const base = s || e;
    const codDif = s && e && normalizarCodigo(s.codigo) !== normalizarCodigo(e.codigo);
    const de = s?.arm || '—', para = e?.arm || '—';
    const rota = !s ? 'entrada interna (produção/ajuste)' : !e ? 'saída interna (consumo/ajuste)'
      : typeof iRota === 'function' ? iRota(de, para, codDif) : 'transferência';
    out.push({ s, e, base, de, para, codDif, rota, emissao:base.emissao, un:base.un, qtd:Number(base.quantidade) || 0, usuario:base.usuario, doc:base.nf });
  }
  return out.sort((a, b) => String(b.emissao).localeCompare(String(a.emissao)));
}

/* ═══════════ GRÁFICO DE BARRAS (uma série) ═══════════ */
function anBarras(pts, rotulo, fmt = anQ) {
  const W = 640, H = 170, m = { l:44, r:8, t:10, b:22 };
  const max = Math.max(1, ...pts.map(p => p.v));
  const passo = Math.pow(10, Math.floor(Math.log10(max)));
  const topo = Math.ceil(max / passo) * passo;
  const iw = W - m.l - m.r, ih = H - m.t - m.b, bw = Math.max(2, iw / pts.length - 2);
  const y = v => m.t + ih - v / topo * ih;
  const ticks = [0, topo / 2, topo];
  const curto = v => v >= 1e6 ? num1(v / 1e6) + ' mi' : v >= 1e4 ? num(Math.round(v / 1e3)) + ' mil' : num(Math.round(v * 10) / 10);
  const idx = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
  return `<svg class="an-graf" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(rotulo)}">
    ${ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="sa-grade"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end" class="sa-eixo">${curto(t)}</text>`).join('')}
    ${pts.map((p, i) => { const x = m.l + i * (iw / pts.length) + 1, h = Math.max(p.v ? 2 : 0, m.t + ih - y(p.v));
      return `<g class="an-bar"><rect x="${x - 1}" y="${m.t}" width="${iw / pts.length}" height="${ih}" fill="transparent"/>` +
        `<rect x="${x}" y="${m.t + ih - h}" width="${bw}" height="${h}" rx="${Math.min(3, bw / 2)}"/><title>${saData(p.d)}: ${fmt(p.v)}</title></g>`; }).join('')}
    ${idx.map(i => `<text x="${m.l + i * (iw / pts.length) + bw / 2}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" class="sa-eixo">${saData(pts[i].d).slice(0, 5)}</text>`).join('')}
  </svg>`;
}
function anPorDia(ls, valor) {
  const { de, ate } = anJanela(_an.periodo);
  const m = new Map();
  for (let d = new Date(de); d <= ate; d.setDate(d.getDate() + 1)) m.set(anIso(d), 0);
  for (const r of ls) { const k = String(r.emissao).slice(0, 10); if (m.has(k)) m.set(k, m.get(k) + valor(r)); }
  return [...m].map(([d, v]) => ({ d, v }));
}

/* ═══════════ RENDER ═══════════ */
function renderAnalista() {
  const corpo = $('an-corpo');
  if (!corpo || !_an.rows) return;
  const { de, ate } = anJanela(_an.periodo);
  $('an-sub').innerHTML = `Movimentações do ERP de <b>${saData(anIso(de))}</b> a <b>${saData(anIso(ate))}</b>` +
    (_an.sync ? ` · última atualização ${esc(fmtTS(_an.sync.quando))} (${esc(haQuanto(new Date(_an.sync.quando).getTime()))})` : '') + '.';
  $('an-ctrl').innerHTML = `<div class="seg">${AN_PERIODOS.map(([v, t]) => `<button class="${_an.periodo === v ? 'active' : ''}" onclick="anPeriodo('${v}')">${t}</button>`).join('')}</div>
    <div class="seg">${[['', 'PA e ME'], ['PA', 'PA'], ['ME', 'ME']].map(([v, t]) => `<button class="${_an.tipo === v ? 'active' : ''}" onclick="anSet('tipo','${v}')">${t}</button>`).join('')}</div>`;
  $('an-abas').innerHTML = AN_ABAS.map(([id, rot]) => `<button role="tab" aria-selected="${_an.aba === id}" class="${_an.aba === id ? 'active' : ''}" onclick="anAba('${id}')">${rot}</button>`).join('');

  if (_an.erro) {
    corpo.innerHTML = `<div class="aviso a-warn"><span class="aviso-ico">!</span><div><b>As movimentações ainda não chegam</b>
      Rode o <code>sql/migracao-movimentos.sql</code> no Supabase e instale o robô das movimentações (robo/INSTALAR-MOVIMENTOS.bat). (${esc(_an.erro.message || _an.erro)})</div></div>`;
    return;
  }
  if (!_an.rows.length) {
    corpo.innerHTML = `<div class="empty"><div class="empty-ico">◔</div><div class="empty-tit">Nenhuma movimentação ainda</div>
      <div class="empty-sub">O robô das movimentações manda às 07:00 e às 12:00. Para mandar agora: C:\\RoboSaldo\\RODAR-MOVIMENTOS.bat no computador do robô.</div></div>`;
    return;
  }
  const ls = anLinhas();
  _an.export = () => ls.map(r => ({ Emissão:String(r.emissao).slice(0, 10), Filial:r.filial, Tipo:r.tipo_mov, 'Tipo prod.':r.tipo_prod, Código:r.codigo,
    Produto:r.descricao, Quantidade:Number(r.quantidade) || 0, UM:r.un, Lote:r.lote, Armazém:r.arm, Paletes:Number(r.paletes) || 0, Valor:Number(r.valor) || 0,
    NF:r.nf, Série:r.serie, Pedido:r.pedido, Cliente:r.cli_nome, UF:r.cli_uf, TES:r.tes_desc, Usuário:r.usuario }));
  corpo.innerHTML = ({ resumo:anResumo, saidas:anSaidas, clientes:anClientes, entradas:anEntradas, internos:anInternos, cobertura:anCobertura, lista:anLista })[_an.aba](ls);
}

function anKpi(rot, valor, pe, cls = '') {
  return `<div class="kpi ${cls}"><div class="kpi-label">${esc(rot)}</div><div class="kpi-value">${valor}</div><div class="kpi-foot">${pe}</div></div>`;
}

/* ── Resumo ── */
function anResumo(ls) {
  const sai = ls.filter(r => r.tipo_mov === 'Saída'), ant = anLinhas(true).filter(r => r.tipo_mov === 'Saída');
  const o = anSoma(sai), oa = anSoma(ant);
  const ent = anSoma(ls.filter(r => r.tipo_mov === 'Entrada'));
  const tr = anTransferencias(ls);
  const un = _an.un;
  const kpis = `<div class="kpis">
    ${anKpi('Notas faturadas', num(o.nfs.size), anVar(o.nfs.size, oa.nfs.size), 'is-info')}
    ${anKpi('Pedidos atendidos', num(o.peds.size), `${num(o.clis.size)} cliente(s)`)}
    ${anKpi('Volume que saiu', AN_UNS.filter(u => o.q[u]).map(u => `${anQ(o.q[u])}<small> ${u}</small>`).join('<br>') || '0', `${num1(o.pl)} palete(s)`)}
    ${anKpi('Valor das saídas', anR(o.valor), anVar(o.valor, oa.valor))}
    ${anKpi('Entradas', num(ent.nfs.size) + '<small> NF</small>', anQtdTxt(ent))}
    ${anKpi('Movimentos internos', num(tr.length), `${num(tr.filter(t => t.rota === 'liberação da quarentena').length)} liberação(ões) da quarentena`)}
  </div>`;
  const graf = `<div class="an-grafs">
    <div class="panel"><div class="panel-head"><div><div class="section-title">Notas por dia</div><div class="section-note">notas de saída emitidas</div></div></div>
      <div class="panel-body">${anBarras(anPorDia(sai.filter((r, i, a) => a.findIndex(x => anNF(x) === anNF(r)) === i), () => 1), 'Notas por dia', v => `${num(v)} nota(s)`)}</div></div>
    <div class="panel"><div class="panel-head"><div><div class="section-title">Volume que saiu por dia</div><div class="section-note">só ${esc(un)} — unidades não se somam</div></div>
      <div class="seg">${AN_UNS.map(u => `<button class="${un === u ? 'active' : ''}" onclick="anSet('un','${u}')">${u}</button>`).join('')}</div></div>
      <div class="panel-body">${anBarras(anPorDia(sai.filter(r => r.un === un), r => Number(r.quantidade) || 0), `Volume em ${un} por dia`, v => `${anQ(v)} ${un}`)}</div></div>
  </div>`;
  return kpis + graf + `<div class="panel"><div class="panel-head"><div><div class="section-title">Destaques do período</div><div class="section-note">o que os números dizem</div></div></div>
    <div class="panel-body"><ul class="an-dest">${anDestaques(ls, sai, o).map(t => `<li>${t}</li>`).join('') || '<li>Pouco movimento no período para tirar conclusões.</li>'}</ul></div></div>`;
}

function anDestaques(ls, sai, o) {
  const out = [];
  // Dia mais forte
  const porDia = {};
  for (const r of sai) (porDia[String(r.emissao).slice(0, 10)] ||= new Set()).add(anNF(r));
  const dia = Object.entries(porDia).sort((a, b) => b[1].size - a[1].size)[0];
  if (dia) out.push(`Dia com mais notas: <b>${saData(dia[0])}</b>, com ${num(dia[1].size)} nota(s).`);
  // Produto e cliente que mais saíram (por unidade principal)
  for (const u of AN_UNS) {
    if (!o.q[u]) continue;
    const p = {};
    for (const r of sai) if (r.un === u) { const x = p[r.codigo] ||= { d:r.descricao, q:0 }; x.q += Number(r.quantidade) || 0; }
    const top = Object.values(p).sort((a, b) => b.q - a.q)[0];
    if (top) out.push(`Produto que mais saiu em ${u}: <b>${esc(top.d)}</b> — ${anQ(top.q)} ${u} (${num1(top.q / o.q[u] * 100)}% do volume em ${u}).`);
  }
  const c = {};
  for (const r of sai) if (r.cli_nome) { const x = c[r.cli_nome] ||= { n:new Set(), v:0, uf:r.cli_uf }; x.n.add(anNF(r)); x.v += Number(r.valor) || 0; }
  const topC = Object.entries(c).sort((a, b) => b[1].v - a[1].v)[0];
  if (topC) out.push(`Maior cliente em valor: <b>${esc(topC[0])}</b>${topC[1].uf ? ` (${esc(topC[1].uf)})` : ''} — ${num(topC[1].n.size)} nota(s), ${anR(topC[1].v)}.`);
  // Tipos de saída que não são venda
  const bon = sai.filter(r => /BONIFIC/i.test(r.tes_desc || ''));
  if (bon.length) out.push(`Bonificação: ${num(new Set(bon.map(anNF)).size)} nota(s), ${anQtdTxt(anSoma(bon))}.`);
  const dev = ls.filter(r => /DEVOLU/i.test(r.tes_desc || ''));
  if (dev.length) out.push(`Devoluções: ${num(new Set(dev.map(anNF)).size)} nota(s), ${anQtdTxt(anSoma(dev))}.`);
  // Internos
  const tr = anTransferencias(ls);
  const lib = tr.filter(t => t.rota === 'liberação da quarentena');
  if (lib.length) out.push(`Liberado da quarentena: ${num(lib.length)} lote(s), ${anQtdTxt(anSoma(lib.map(t => t.base)))}.`);
  const fr = tr.filter(t => t.rota === 'fracionamento');
  if (fr.length) out.push(`Fracionamentos: ${num(fr.length)}.`);
  // Cobertura
  const cob = anCoberturaCalc();
  const curta = cob.filter(c => c.dias !== null && c.dias < 15);
  const risco = cob.filter(c => c.risco > 0.001);
  if (curta.length) out.push(`<b>${num(curta.length)}</b> produto(s) com estoque para menos de 15 dias no ritmo atual — veja a aba Cobertura.`);
  if (risco.length) out.push(`<b>${num(risco.length)}</b> produto(s) com lote que deve vencer antes de sair no ritmo atual — veja a aba Cobertura.`);
  return out;
}

/* ── Saídas ── */
function anSaidas(ls) {
  const sai = ls.filter(r => r.tipo_mov === 'Saída');
  const porTes = new Map();
  for (const r of sai) { const k = r.tes_desc || '(sem TES)'; (porTes.get(k) || porTes.set(k, []).get(k)).push(r); }
  const tes = [...porTes].map(([k, rs]) => ({ k, o:anSoma(rs) })).sort((a, b) => b.o.nfs.size - a.o.nfs.size);
  const porProd = new Map();
  for (const r of sai) { const k = `${r.filial}|${r.codigo}`; (porProd.get(k) || porProd.set(k, []).get(k)).push(r); }
  const totU = anSoma(sai).q;
  const prods = [...porProd.values()].map(rs => ({ r:rs[0], o:anSoma(rs) })).sort((a, b) => (b.o.q[b.r.un] || 0) / (totU[b.r.un] || 1) - (a.o.q[a.r.un] || 0) / (totU[a.r.un] || 1));
  const p = fatiar('an-sai', prods, _an.periodo + _an.tipo + prods.length);
  const colsU = u => AN_UNS.map(x => `<td class="num">${u.q[x] ? anQ(u.q[x]) : '<span class="num-zero">—</span>'}</td>`).join('');
  return `<div class="panel"><div class="panel-head"><div><div class="section-title">Saídas por tipo</div><div class="section-note">pela TES da nota</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tipo</th><th class="num">Notas</th><th class="num">Pedidos</th>${AN_UNS.map(u => `<th class="num">${u}</th>`).join('')}<th class="num">Paletes</th><th class="num">Valor</th></tr></thead>
    <tbody>${tes.map(x => `<tr><td>${esc(x.k)}</td><td class="num">${num(x.o.nfs.size)}</td><td class="num">${num(x.o.peds.size)}</td>${colsU(x.o)}<td class="num">${num1(x.o.pl)}</td><td class="num">${anR(x.o.valor)}</td></tr>`).join('') || '<tr><td colspan="8" class="num-zero">Nenhuma saída no período.</td></tr>'}</tbody></table></div></div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">Produtos que mais saíram</div><div class="section-note">ordenados pela fatia do volume da unidade deles</div></div>
    <button class="btn btn-sm" onclick="anExportar()">Exportar Excel</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th>Filial</th><th class="num">Quantidade</th><th class="num">% da unidade</th><th class="num">Notas</th><th class="num">Clientes</th><th class="num">Paletes</th><th class="num">Valor</th></tr></thead>
    <tbody>${p.itens.map(x => { const q = x.o.q[x.r.un] || 0; return `<tr><td class="nome">${esc(x.r.descricao || x.r.codigo)}<div class="sub mono">${esc(x.r.codigo)} · ${esc(x.r.tipo_prod || '')}</div></td>
      <td>${badgeFilial(x.r.filial, x.r.codigo)}</td><td class="num"><b>${anQ(q)}</b> <small class="sa-un">${esc(x.r.un)}</small></td><td class="num">${num1(q / (totU[x.r.un] || 1) * 100)}%</td>
      <td class="num">${num(x.o.nfs.size)}</td><td class="num">${num(x.o.clis.size)}</td><td class="num">${num1(x.o.pl)}</td><td class="num">${anR(x.o.valor)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="num-zero">—</td></tr>'}</tbody></table></div>
    ${barraPag('an-sai', p, 'produto(s)')}</div>`;
}

/* ── Clientes ── */
function anClientes(ls) {
  const sai = ls.filter(r => r.tipo_mov === 'Saída' && anCli(r));
  const g = new Map();
  for (const r of sai) { const k = anCli(r); (g.get(k) || g.set(k, []).get(k)).push(r); }
  const clis = [...g.values()].map(rs => ({ r:rs[0], o:anSoma(rs), ult:rs.map(x => String(x.emissao).slice(0, 10)).sort().pop() })).sort((a, b) => b.o.valor - a.o.valor);
  const uf = new Map();
  for (const r of sai) { const k = r.cli_uf || '—'; (uf.get(k) || uf.set(k, []).get(k)).push(r); }
  const ufs = [...uf].map(([k, rs]) => ({ k, o:anSoma(rs) })).sort((a, b) => b.o.valor - a.o.valor);
  const p = fatiar('an-cli', clis, _an.periodo + _an.tipo + clis.length);
  const colsU = u => AN_UNS.map(x => `<td class="num">${u.q[x] ? anQ(u.q[x]) : '<span class="num-zero">—</span>'}</td>`).join('');
  return `<div class="an-duas">
  <div class="panel"><div class="panel-head"><div><div class="section-title">Clientes</div><div class="section-note">${num(clis.length)} no período, pelo valor</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th>UF</th><th class="num">Notas</th>${AN_UNS.map(u => `<th class="num">${u}</th>`).join('')}<th class="num">Valor</th><th>Última</th></tr></thead>
    <tbody>${p.itens.map(x => `<tr><td class="nome">${esc(x.r.cli_nome || x.r.cli_cod)}</td><td>${esc(x.r.cli_uf || '—')}</td><td class="num">${num(x.o.nfs.size)}</td>${colsU(x.o)}<td class="num">${anR(x.o.valor)}</td><td class="mono">${saData(x.ult)}</td></tr>`).join('') || '<tr><td colspan="8" class="num-zero">Nenhuma saída no período.</td></tr>'}</tbody></table></div>
    ${barraPag('an-cli', p, 'cliente(s)')}</div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">Por estado</div><div class="section-note">para onde foi</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>UF</th><th class="num">Notas</th><th class="num">Clientes</th><th class="num">Valor</th></tr></thead>
    <tbody>${ufs.map(x => `<tr><td>${esc(x.k)}</td><td class="num">${num(x.o.nfs.size)}</td><td class="num">${num(x.o.clis.size)}</td><td class="num">${anR(x.o.valor)}</td></tr>`).join('') || '<tr><td colspan="4" class="num-zero">—</td></tr>'}</tbody></table></div></div>
  </div>`;
}

/* ── Entradas ── */
function anEntradas(ls) {
  const ent = ls.filter(r => r.tipo_mov === 'Entrada');
  const g = new Map();
  for (const r of ent) { const k = r.tes_desc || '(sem TES)'; (g.get(k) || g.set(k, []).get(k)).push(r); }
  const tipos = [...g].map(([k, rs]) => ({ k, o:anSoma(rs) })).sort((a, b) => b.o.linhas - a.o.linhas);
  const p = fatiar('an-ent', [...ent].reverse(), _an.periodo + _an.tipo + ent.length);
  const colsU = u => AN_UNS.map(x => `<td class="num">${u.q[x] ? anQ(u.q[x]) : '<span class="num-zero">—</span>'}</td>`).join('');
  return `<div class="panel"><div class="panel-head"><div><div class="section-title">Entradas por tipo</div><div class="section-note">notas de entrada (compra, transferência entre filiais, devolução…)</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tipo</th><th class="num">Notas</th>${AN_UNS.map(u => `<th class="num">${u}</th>`).join('')}<th class="num">Valor</th></tr></thead>
    <tbody>${tipos.map(x => `<tr><td>${esc(x.k)}</td><td class="num">${num(x.o.nfs.size)}</td>${colsU(x.o)}<td class="num">${anR(x.o.valor)}</td></tr>`).join('') || '<tr><td colspan="6" class="num-zero">Nenhuma entrada no período.</td></tr>'}</tbody></table></div></div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">Notas de entrada</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Produto</th><th>Lote</th><th>Arm.</th><th class="num">Quantidade</th><th>NF</th><th>Tipo</th><th>Fornecedor</th></tr></thead>
    <tbody>${p.itens.map(r => `<tr><td class="mono">${saData(String(r.emissao).slice(0, 10))}</td><td class="nome">${esc(r.descricao || r.codigo)}<div class="sub mono">${esc(r.codigo)}</div></td><td class="mono">${esc(r.lote || '—')}</td><td class="mono">${esc(r.arm)}</td>
      <td class="num">${anQ(r.quantidade)} <small class="sa-un">${esc(r.un)}</small></td><td class="mono">${esc(r.nf || '—')}</td><td>${esc(r.tes_desc || '—')}</td><td>${esc(r.cli_nome || '—')}</td></tr>`).join('') || '<tr><td colspan="8" class="num-zero">—</td></tr>'}</tbody></table></div>
    ${barraPag('an-ent', p, 'nota(s)')}</div>`;
}

/* ── Internos ── */
function anInternos(ls) {
  const tr = anTransferencias(ls);
  const g = new Map();
  for (const t of tr) { const k = `${t.rota}|${t.de}|${t.para}`; (g.get(k) || g.set(k, []).get(k)).push(t); }
  const rotas = [...g.values()].map(ts => ({ t:ts[0], n:ts.length, o:anSoma(ts.map(x => x.base)) })).sort((a, b) => b.n - a.n);
  const us = {};
  for (const t of tr) if (t.usuario) us[t.usuario] = (us[t.usuario] || 0) + 1;
  const p = fatiar('an-int', tr, _an.periodo + _an.tipo + tr.length);
  return `<div class="an-duas">
  <div class="panel"><div class="panel-head"><div><div class="section-title">Por caminho</div><div class="section-note">de qual armazém para qual</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>O quê</th><th>De → para</th><th class="num">Vezes</th><th class="num">Quantidade</th></tr></thead>
    <tbody>${rotas.map(x => `<tr><td>${esc(x.t.rota)}</td><td class="mono">${esc(x.t.de)} → ${esc(x.t.para)}</td><td class="num">${num(x.n)}</td><td class="num">${anQtdTxt(x.o)}</td></tr>`).join('') || '<tr><td colspan="4" class="num-zero">Nenhum movimento interno no período.</td></tr>'}</tbody></table></div></div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">Quem lançou no ERP</div><div class="section-note">movimentos internos</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Usuário</th><th class="num">Movimentos</th></tr></thead>
    <tbody>${Object.entries(us).sort((a, b) => b[1] - a[1]).map(([u, n]) => `<tr><td>${esc(u)}</td><td class="num">${num(n)}</td></tr>`).join('') || '<tr><td colspan="2" class="num-zero">—</td></tr>'}</tbody></table></div></div>
  </div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">Movimentos internos</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>O quê</th><th>Produto</th><th>Lote</th><th>De → para</th><th class="num">Quantidade</th><th>Doc.</th><th>Por</th></tr></thead>
    <tbody>${p.itens.map(t => `<tr><td class="mono">${saData(String(t.emissao).slice(0, 10))}</td><td>${esc(t.rota)}</td>
      <td class="nome">${esc(t.base.descricao || t.base.codigo)}${t.codDif ? `<div class="sub">vira ${esc(t.e.descricao || t.e.codigo)}</div>` : ''}</td><td class="mono">${esc(t.base.lote || '—')}</td>
      <td class="mono">${esc(t.de)} → ${esc(t.para)}</td><td class="num">${anQ(t.qtd)} <small class="sa-un">${esc(t.un)}</small></td><td class="mono">${esc(t.doc || '—')}</td><td>${esc(t.usuario || '—')}</td></tr>`).join('') || '<tr><td colspan="8" class="num-zero">—</td></tr>'}</tbody></table></div>
    ${barraPag('an-int', p, 'movimento(s)')}</div>`;
}

/* ── Cobertura: quantos dias o estoque dura no ritmo dos últimos 30 dias,
      e o que vence antes de sair (consumindo do lote que vence primeiro). ── */
function anCoberturaCalc() {
  if (!_sa?.ok || !_an.rows) return [];
  const desde = anIso(new Date(Date.now() - 30 * 864e5));
  const saidas = new Map();
  for (const r of _an.rows) if (r.tipo_mov === 'Saída' && String(r.emissao).slice(0, 10) >= desde && (!_an.tipo || r.tipo_prod === _an.tipo)) {
    const k = `${r.filial}|${normalizarCodigo(r.codigo)}`;
    saidas.set(k, (saidas.get(k) || 0) + (Number(r.quantidade) || 0));
  }
  const g = new Map();
  for (const l of _sa.ref) {
    // Vencido não conta: não sai para venda (a regra de validade avisa dele na tela Hoje).
    if (!(l.saldo > 0) || AN_ARM_FORA_VENDA.includes(l.arm) || (l.dias !== null && l.dias < 0) || (typeof daFilial === 'function' && !daFilial(l.filial)) || (_an.tipo && l.tipo !== _an.tipo)) continue;
    const k = `${l.filial}|${normalizarCodigo(l.cod)}`;
    const x = g.get(k) || g.set(k, { k, l, lotes:[], disp:0 }).get(k);
    x.lotes.push(l); x.disp += Math.max(0, l.saldo - (l.emp || 0));
  }
  const out = [];
  for (const x of g.values()) {
    const porDia = (saidas.get(x.k) || 0) / 30;
    const dias = porDia > 0 ? x.disp / porDia : null;
    // FEFO: consome do lote que vence primeiro; o que sobra na data de validade vence parado.
    let risco = 0, loteRisco = null, consumido = 0;
    for (const l of [...x.lotes].sort((a, b) => String(a.val || '9999').localeCompare(String(b.val || '9999')))) {
      const livre = Math.max(0, l.saldo - (l.emp || 0));
      if (l.dias === null) { consumido += livre; continue; }
      const ateVencer = Math.max(0, l.dias) * porDia - consumido;    // quanto ainda sai até a validade dele
      const sobra = livre - Math.max(0, ateVencer);
      if (sobra > 0.001) { risco += sobra; if (!loteRisco) loteRisco = l; consumido += livre - sobra; }
      else consumido += livre;
    }
    out.push({ ...x, porDia, dias, risco, loteRisco });
  }
  return out;
}
function anCobertura() {
  if (!_sa?.ok) return '<div class="skeleton">carregando o saldo do ERP…</div>';
  const cob = anCoberturaCalc();
  const ordem = [...cob].sort((a, b) => (b.risco > 0) - (a.risco > 0) || (a.dias ?? 1e9) - (b.dias ?? 1e9));
  const parados = cob.filter(c => !c.porDia).sort((a, b) => b.disp - a.disp);
  const p = fatiar('an-cob', ordem.filter(c => c.porDia), _an.tipo + ordem.length);
  const fimTxt = d => { if (d === null) return '—'; const f = new Date(Date.now() + d * 864e5); return saData(anIso(f)); };
  return `<div class="aviso a-info"><span class="aviso-ico">◔</span><div><b>Como ler</b>
    Ritmo = média das notas de saída dos últimos 30 dias. Estoque = saldo livre (sem empenho) e dentro da validade, nos armazéns de venda — fora quarentena, retrabalho, avaria, vencidos, descarte e bloqueado.
    "Vence antes de sair" consome primeiro o lote que vence primeiro (FEFO).</div></div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">Cobertura do estoque</div><div class="section-note">produtos com saída nos últimos 30 dias</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th class="num">Estoque livre</th><th class="num">Sai por dia</th><th class="num">Dura</th><th>Acaba em</th><th class="num">Vence antes de sair</th></tr></thead>
    <tbody>${p.itens.map(c => `<tr><td class="nome">${esc(c.l.desc)}<div class="sub mono">${esc(c.l.cod)} · ${esc(filialCurta(c.l.filial))}</div></td>
      <td class="num">${anQ(c.disp)} <small class="sa-un">${esc(c.l.un)}</small></td><td class="num">${anQ(c.porDia)}</td>
      <td class="num"><b class="${c.dias < 15 ? 'sa-warn' : ''}">${num(Math.round(c.dias))} dia(s)</b></td><td class="mono">${fimTxt(c.dias)}</td>
      <td class="num">${c.risco > 0.001 ? `<span class="num-neg"><b>${anQ(c.risco)}</b> ${esc(c.l.un)}</span><div class="sub">lote ${esc(c.loteRisco?.lote || '—')} vence ${saData(c.loteRisco?.val)}</div>` : '<span class="num-zero">—</span>'}</td></tr>`).join('') ||
      '<tr><td colspan="6" class="num-zero">Nenhum produto com saída nos últimos 30 dias.</td></tr>'}</tbody></table></div>
    ${barraPag('an-cob', p, 'produto(s)')}</div>
  <div class="panel"><div class="panel-head"><div><div class="section-title">Com estoque e sem saída em 30 dias</div><div class="section-note">${num(parados.length)} produto(s), pelo estoque livre</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th class="num">Estoque livre</th><th>Vence primeiro</th></tr></thead>
    <tbody>${parados.slice(0, 30).map(c => { const v = [...c.lotes].filter(l => l.val).sort((a, b) => a.val.localeCompare(b.val))[0];
      return `<tr><td class="nome">${esc(c.l.desc)}<div class="sub mono">${esc(c.l.cod)} · ${esc(filialCurta(c.l.filial))}</div></td><td class="num">${anQ(c.disp)} <small class="sa-un">${esc(c.l.un)}</small></td>
      <td class="mono">${v ? `${saData(v.val)} · ${esc(v.lote)}` : '—'}</td></tr>`; }).join('') || '<tr><td colspan="3" class="num-zero">—</td></tr>'}</tbody></table></div></div>`;
}

/* ── Lista ── */
function anLista(ls) {
  const q = (_an.busca || '').trim().toUpperCase();
  const f = ls.filter(r => (!_an.tipoMov || r.tipo_mov === _an.tipoMov) &&
    (!q || [r.codigo, r.descricao, r.lote, r.nf, r.pedido, r.cli_nome, r.usuario].some(v => String(v || '').toUpperCase().includes(q))));
  const p = fatiar('an-lis', [...f].reverse(), _an.periodo + _an.tipo + _an.tipoMov + q + f.length);
  return `<div class="panel"><div class="panel-head">
      <div class="an-filtros"><input type="search" placeholder="Produto, lote, NF, pedido, cliente ou usuário" value="${esc(_an.busca)}" oninput="_an.busca=this.value;clearTimeout(_an.t);_an.t=setTimeout(renderAnalista,300)" aria-label="Buscar">
      <div class="seg">${[['', 'Todos'], ['Saída', 'Saídas'], ['Entrada', 'Entradas'], ['Saída Interna', 'Saída int.'], ['Entrada Interna', 'Entrada int.']].map(([v, t]) => `<button class="${_an.tipoMov === v ? 'active' : ''}" onclick="anSet('tipoMov','${v}')">${t}</button>`).join('')}</div></div>
      <button class="btn btn-sm" onclick="anExportar()">Exportar Excel</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th>Lote</th><th>Arm.</th><th class="num">Quantidade</th><th>NF / doc.</th><th>Pedido</th><th>Cliente / por</th></tr></thead>
    <tbody>${p.itens.map(r => `<tr><td class="mono">${saData(String(r.emissao).slice(0, 10))}</td><td><span class="tag ${r.tipo_mov === 'Saída' ? 't-warn' : r.tipo_mov === 'Entrada' ? 't-ok' : 't-mute'}">${esc(r.tipo_mov)}</span></td>
      <td class="nome">${esc(r.descricao || r.codigo)}<div class="sub mono">${esc(r.codigo)} · ${esc(filialCurta(r.filial))}</div></td><td class="mono">${esc(r.lote || '—')}</td><td class="mono">${esc(r.arm)}</td>
      <td class="num">${anQ(r.quantidade)} <small class="sa-un">${esc(r.un)}</small></td><td class="mono">${esc(r.nf || '—')}<div class="sub">${esc(r.tes_desc || '')}</div></td><td class="mono">${esc(r.pedido || '—')}</td>
      <td>${esc(r.cli_nome || r.usuario || '—')}${r.cli_uf ? ` <span class="sub">${esc(r.cli_uf)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="num-zero">Nada com esses filtros.</td></tr>'}</tbody></table></div>
    ${barraPag('an-lis', p, 'movimento(s)')}</div>`;
}

function anExportar() {
  const dados = _an.export ? _an.export() : [];
  if (!dados.length) { toast('Nada para exportar.', 'warn'); return; }
  const { de, ate } = anJanela(_an.periodo);
  const nome = `movimentacoes-${anIso(de)}-a-${anIso(ate)}`;
  if (typeof XLSX === 'undefined') { toast('O exportador de Excel não carregou.', 'err'); return; }
  const ws = XLSX.utils.json_to_sheet(dados);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Movimentações');
  XLSX.writeFile(wb, nome + '.xlsx');
}
