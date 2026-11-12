/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · ANALISTA (movimentações do ERP)

   Lê a tabela erp_mov (robô das movimentações, 07:00 e 12:00) e
   mostra o período escolhido: notas faturadas, pedidos, clientes,
   volume por unidade, entradas, transferências internas, quem lançou
   e a cobertura do estoque (quantos dias o saldo dura no ritmo de
   saída — e o que vai vencer antes de sair).

   Litro, quilo e dose nunca se somam: cada unidade tem a sua coluna.
   ═══════════════════════════════════════════════════════════════ */

const _an = { rows:null, erro:null, sync:null, periodo:'30', aba:'resumo', un:'L', met:'nfs', tipo:'', busca:'', tipoMov:'', carregado:0 };
const AN_PERIODOS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['mesant', 'Mês passado'], ['90', '90 dias']];
const AN_ABAS = [['resumo', 'Expedição'], ['saidas', 'Saídas'], ['clientes', 'Clientes'], ['entradas', 'Entradas'], ['internos', 'Internos'], ['cobertura', 'Cobertura'], ['lista', 'Movimentos']];
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
    // (e o mês passado inteiro, para o "Ritmo do mês")
    const h0 = new Date(); const iniMesAnt = new Date(h0.getFullYear(), h0.getMonth() - 1, 1);
    const ini = new Date(Math.min(de.getTime() - len * 864e5, Date.now() - 31 * 864e5, iniMesAnt.getTime()));
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
// Curto para os cartões: R$ 20,9 mi · R$ 245 mil.
const anRc = v => { v = Number(v) || 0; return v >= 1e6 ? `R$ ${num1(v / 1e6)} mi` : v >= 1e4 ? `R$ ${num(Math.round(v / 1e3))} mil` : anR(v); };
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

/* ═══════════ EXPEDIÇÃO (painel principal do Analista) ═══════════ */

// Tipo de saída pela TES (a ordem importa: "DEVOLUCAO TRAN" é devolução).
function anCat(r) {
  const t = String(r.tes_desc || '');
  if (/DEVOLU|^DEV\b/i.test(t)) return 'Devolução';
  if (/^TRAN|TRANSFER/i.test(t)) return 'Transferência entre filiais';
  if (/EXPORTA/i.test(t)) return 'Exportação';
  if (/BONIFIC/i.test(t)) return 'Bonificação';
  if (/DESCARTE/i.test(t)) return 'Descarte';
  if (/VENDA|REVENDA/i.test(t)) return 'Venda';
  if (/REMESSA|TESTE|AMOSTRA|RETORNO/i.test(t)) return 'Remessa / teste';
  return 'Outros';
}
const anFaturado = r => ['Venda', 'Exportação'].includes(anCat(r));
// Palete equivalente: pela quantidade por palete do cadastro. A coluna
// "Pallets" do ERP arredonda cada linha para cima (uma caixa = 1 palete).
function anPl(r) {
  const p = Number(produtoPorCodigo(normalizarCodigo(r.codigo))?.palete) || 0;
  return p ? (Number(r.quantidade) || 0) / p : (Number(r.paletes) || 0);
}
const AN_METRICAS = [['nfs', 'Notas'], ['pl', 'Paletes'], ['valor', 'Valor'], ['L', 'Litros'], ['KG', 'Quilos'], ['DS', 'Doses']];
function anValorDe(met) {
  if (met === 'pl') return r => anPl(r);
  if (met === 'valor') return r => Number(r.valor) || 0;
  if (AN_UNS.includes(met)) return r => r.un === met ? Number(r.quantidade) || 0 : 0;
  return null;    // notas: conta notas distintas
}
function anSerie(ls, met, de, ate) {
  const m = new Map();
  for (let d = new Date(de); d <= ate; d.setDate(d.getDate() + 1)) m.set(anIso(d), met === 'nfs' ? new Set() : 0);
  const val = anValorDe(met);
  for (const r of ls) {
    const k = String(r.emissao).slice(0, 10);
    if (!m.has(k)) continue;
    if (met === 'nfs') m.get(k).add(anNF(r)); else m.set(k, m.get(k) + val(r));
  }
  return [...m].map(([d, v]) => ({ d, v:met === 'nfs' ? v.size : v }));
}
const anFmtMet = met => met === 'valor' ? anR : met === 'nfs' ? (v => num(Math.round(v))) : met === 'pl' ? (v => num1(v)) : (v => `${anQ(v)} ${met}`);
const AN_DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/* Barras por dia, com a linha da média e o melhor dia marcado. */
function anBarrasMedia(pts, rotulo, fmt) {
  const W = 760, H = 220, m = { l:48, r:70, t:22, b:24 };
  const ativos = pts.filter(p => p.v > 0);
  const media = ativos.length ? ativos.reduce((s, p) => s + p.v, 0) / ativos.length : 0;
  const max = Math.max(1, ...pts.map(p => p.v));
  const passo = Math.pow(10, Math.floor(Math.log10(max)));
  const topo = Math.ceil(max / passo * 2) / 2 * passo;
  const iw = W - m.l - m.r, ih = H - m.t - m.b, slot = iw / pts.length, bw = Math.max(2, Math.min(28, slot - 3));
  const y = v => m.t + ih - v / topo * ih;
  const curto = v => v >= 1e6 ? num1(v / 1e6) + ' mi' : v >= 1e4 ? num(Math.round(v / 1e3)) + ' mil' : num(Math.round(v * 10) / 10);
  const iMax = pts.reduce((b, p, i) => p.v > pts[b].v ? i : b, 0);
  const marcas = pts.length <= 14 ? pts.map((_, i) => i) : [...new Set([0, Math.floor(pts.length / 3), Math.floor(2 * pts.length / 3), pts.length - 1])];
  const fimDeSemana = d => { const w = new Date(d + 'T12:00').getDay(); return w === 0 || w === 6; };
  return `<svg class="an-graf an-graf-g" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(rotulo)}">
    ${[0, topo / 2, topo].map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="sa-grade"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" class="sa-eixo">${curto(t)}</text>`).join('')}
    ${pts.map((p, i) => { const x = m.l + i * slot + (slot - bw) / 2, h = p.v ? Math.max(2, m.t + ih - y(p.v)) : 0;
      return `<g class="an-bar${fimDeSemana(p.d) ? ' fds' : ''}${i === iMax && p.v ? ' max' : ''}"><rect x="${m.l + i * slot}" y="${m.t}" width="${slot}" height="${ih}" fill="transparent"/>` +
        `<rect x="${x}" y="${m.t + ih - h}" width="${bw}" height="${h}" rx="${Math.min(4, bw / 2)}"/><title>${AN_DOW[new Date(p.d + 'T12:00').getDay()]} ${saData(p.d)}: ${fmt(p.v)}</title></g>`; }).join('')}
    ${media ? `<line x1="${m.l}" x2="${W - m.r}" y1="${y(media)}" y2="${y(media)}" class="an-media"/><text x="${W - m.r + 6}" y="${y(media) + 4}" class="an-media-t">média ${fmt(media)}</text>` : ''}
    ${pts[iMax]?.v ? `<text x="${m.l + iMax * slot + slot / 2}" y="${y(pts[iMax].v) - 6}" text-anchor="middle" class="an-max-t">${fmt(pts[iMax].v)}</text>` : ''}
    ${marcas.map(i => `<text x="${m.l + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle" class="sa-eixo">${saData(pts[i].d).slice(0, 5)}</text>`).join('')}
  </svg>`;
}

/* Mês atual × mês passado, acumulado dia a dia. */
function anRitmoMes(met) {
  const h = new Date(); h.setHours(0, 0, 0, 0);
  const iniA = new Date(h.getFullYear(), h.getMonth(), 1), iniP = new Date(h.getFullYear(), h.getMonth() - 1, 1);
  const fimP = new Date(h.getFullYear(), h.getMonth(), 0);
  const base = (_an.rows || []).filter(r => r.tipo_mov === 'Saída' && (typeof daFilial !== 'function' || daFilial(r.filial)) && (!_an.tipo || r.tipo_prod === _an.tipo));
  const acum = (de, ate) => { let s = 0; return anSerie(base, met, de, ate).map(p => (s += p.v)); };
  const a = acum(iniA, h), p = acum(iniP, fimP);
  if (!p.length || (_an.ini && _an.ini > iniP)) return '';
  const n = Math.max(a.length, p.length);
  const W = 760, H = 200, m = { l:52, r:110, t:14, b:24 };
  const max = Math.max(1, ...a, ...p);
  const x = i => m.l + i / Math.max(1, n - 1) * (W - m.l - m.r), y = v => m.t + (H - m.t - m.b) - v / max * (H - m.t - m.b);
  const caminho = s => s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const fmt = anFmtMet(met);
  const hojeA = a[a.length - 1] || 0, mesmoDiaP = p[Math.min(a.length, p.length) - 1] || 0;
  const dif = mesmoDiaP ? (hojeA - mesmoDiaP) / mesmoDiaP * 100 : null;
  const mes = d => d.toLocaleDateString('pt-BR', { month:'long' });
  return `<div class="panel"><div class="panel-head"><div><div class="section-title">Ritmo do mês</div>
      <div class="section-note">acumulado de ${esc(mes(iniA))} contra ${esc(mes(iniP))}, dia a dia</div></div>
      ${dif !== null ? `<span class="an-chip ${dif >= 0 ? 'up' : 'down'}">${dif >= 0 ? '▲' : '▼'} ${num1(Math.abs(dif))}% ${dif >= 0 ? 'à frente' : 'atrás'} no dia ${a.length}</span>` : ''}</div>
    <div class="panel-body"><svg class="an-graf an-graf-r" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ritmo do mês">
      ${[0, max / 2, max].map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="sa-grade"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" class="sa-eixo">${fmt(t)}</text>`).join('')}
      <path d="${caminho(p)}" class="an-linha-ant"/>
      <path d="${caminho(a)}" class="an-linha"/>
      <circle cx="${x(a.length - 1)}" cy="${y(hojeA)}" r="4" class="an-ponto"/>
      <text x="${x(a.length - 1) + 8}" y="${y(hojeA) + 4}" class="an-rot">${esc(mes(iniA))} · ${fmt(hojeA)}</text>
      <text x="${x(p.length - 1) + 8}" y="${y(p[p.length - 1]) + 4}" class="an-rot ant">${esc(mes(iniP))} · ${fmt(p[p.length - 1])}</text>
      ${[1, 10, 20, n].filter(d => d <= n).map(d => `<text x="${x(d - 1)}" y="${H - 6}" text-anchor="middle" class="sa-eixo">dia ${d}</text>`).join('')}
    </svg></div></div>`;
}

/* Lista com barra horizontal (ranking). */
function anRanking(itens, fmt, vazio = 'Nada no período.') {
  if (!itens.length) return `<div class="hj-vazio">${vazio}</div>`;
  const max = Math.max(...itens.map(x => x.v), 1), tot = itens.reduce((s, x) => s + x.v, 0) || 1;
  return `<ol class="an-rank">${itens.map(x => `<li title="${esc(x.titulo || x.rot)}">
    <div class="an-rank-l"><span class="an-rank-n">${esc(x.rot)}</span>${x.sub ? `<span class="an-rank-s">${esc(x.sub)}</span>` : ''}</div>
    <div class="an-rank-b"><i style="width:${(x.v / max * 100).toFixed(1)}%"></i></div>
    <div class="an-rank-v">${fmt(x.v)}<small>${num1(x.v / tot * 100)}%</small></div></li>`).join('')}</ol>`;
}
function anAgrupar(ls, chaveF, valorF, rotF) {
  const g = new Map();
  for (const r of ls) { const k = chaveF(r); if (k == null || k === '') continue; const x = g.get(k) || g.set(k, { k, v:0, r, nfs:new Set() }).get(k); x.v += valorF(r); if (r.nf) x.nfs.add(anNF(r)); }
  return [...g.values()].sort((a, b) => b.v - a.v).map(x => ({ ...x, ...rotF(x) }));
}
function anSpark(pts) {
  const W = 120, H = 34, max = Math.max(1, ...pts.map(p => p.v));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, pts.length - 1) * W).toFixed(1)},${(H - 2 - p.v / max * (H - 4)).toFixed(1)}`).join('');
  return `<svg class="an-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L${W},${H} L0,${H} Z" class="a"/><path d="${d}" class="l"/></svg>`;
}

function anResumo(ls) {
  const { de, ate } = anJanela(_an.periodo);
  const sai = ls.filter(r => r.tipo_mov === 'Saída');
  const ant = anLinhas(true).filter(r => r.tipo_mov === 'Saída');
  const o = anSoma(sai), oa = anSoma(ant);
  const fat = sai.filter(anFaturado), fatA = ant.filter(anFaturado);
  const valFat = fat.reduce((s, r) => s + (Number(r.valor) || 0), 0), valFatA = fatA.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const nfsFat = new Set(fat.map(anNF)).size;
  const pl = sai.reduce((s, r) => s + anPl(r), 0), plA = ant.reduce((s, r) => s + anPl(r), 0);
  const diasCom = new Set(sai.map(r => String(r.emissao).slice(0, 10))).size || 1;
  const sNf = anSerie(sai, 'nfs', de, ate), sPl = anSerie(sai, 'pl', de, ate), sVal = anSerie(fat, 'valor', de, ate);
  const met = _an.met || 'nfs';
  const fmt = anFmtMet(met);
  const serie = anSerie(met === 'valor' ? fat : sai, met, de, ate);

  const hero = (rot, valor, pe, delta, spark) => `<div class="an-hero">
      <div class="an-hero-t">${esc(rot)}</div><div class="an-hero-v">${valor}</div>
      <div class="an-hero-p">${pe}</div>${delta ? `<div class="an-hero-d">${delta}</div>` : ''}${spark || ''}</div>`;
  const heros = `<div class="an-heros">
    ${hero('Notas expedidas', num(o.nfs.size), `${num1(o.nfs.size / diasCom)} por dia com expedição`, anVar(o.nfs.size, oa.nfs.size), anSpark(sNf))}
    ${hero('Paletes', num1(pl), `${num1(pl / diasCom)} por dia · equivalente cheio`, anVar(pl, plA), anSpark(sPl))}
    ${hero('Faturamento', `<span title="${anR(valFat)}">${anRc(valFat)}</span>`, nfsFat ? `ticket médio ${anR(valFat / nfsFat)} por nota` : 'vendas e exportação', anVar(valFat, valFatA), anSpark(sVal))}
    ${hero('Pedidos', num(o.peds.size), `${num(o.clis.size)} cliente(s) · ${num(new Set(sai.map(r => r.cli_uf).filter(Boolean)).size)} estado(s)`, anVar(o.peds.size, oa.peds.size))}
    <div class="an-hero an-hero-un"><div class="an-hero-t">Volume expedido</div>
      ${AN_UNS.map(u => `<div class="an-un"><span>${u}</span><b>${anQ(o.q[u] || 0)}</b>${anVarCurto(o.q[u] || 0, oa.q[u] || 0)}</div>`).join('')}</div>
  </div>`;

  const grafDia = `<div class="panel"><div class="panel-head"><div><div class="section-title">Expedição por dia</div>
      <div class="section-note">${met === 'valor' ? 'faturamento (vendas e exportação)' : met === 'nfs' ? 'notas de saída emitidas' : met === 'pl' ? 'paletes equivalentes' : `volume em ${met}`} · fim de semana mais claro</div></div>
      <div class="seg">${AN_METRICAS.map(([v, t]) => `<button class="${met === v ? 'active' : ''}" onclick="anSet('met','${v}')">${t}</button>`).join('')}</div></div>
    <div class="panel-body">${anBarrasMedia(serie, 'Expedição por dia', fmt)}</div></div>`;

  // Dia da semana: média por dia trabalhado.
  const porDow = {};
  for (const p of sNf) { const w = new Date(p.d + 'T12:00').getDay(); if (!p.v) continue; const x = porDow[w] ||= { s:0, n:0 }; x.s += p.v; x.n++; }
  const dow = [1, 2, 3, 4, 5, 6].map(w => ({ rot:AN_DOW[w], v:porDow[w] ? porDow[w].s / porDow[w].n : 0, sub:porDow[w] ? `${porDow[w].n} dia(s)` : '' }));

  const cats = anAgrupar(sai, r => anCat(r), r => 1, x => ({ rot:x.k, v:x.nfs.size || 0 }));
  const ufs = anAgrupar(sai, r => r.cli_uf || '—', anPl, x => ({ rot:x.k, sub:`${num(x.nfs.size)} nota(s)` })).slice(0, 10);
  const prods = anAgrupar(sai, r => `${r.filial}|${r.codigo}`, anPl, x => ({ rot:x.r.descricao || x.r.codigo, sub:`${filialCurta(x.r.filial)} · ${num(x.nfs.size)} nota(s)` })).slice(0, 10);
  const clis = anAgrupar(fat, r => r.cli_nome || '', r => Number(r.valor) || 0, x => ({ rot:x.k, sub:`${x.r.cli_uf || '—'} · ${num(x.nfs.size)} nota(s)` })).slice(0, 10);
  const fils = anAgrupar(sai, r => r.filial, anPl, x => ({ rot:filialCurta(x.k), sub:`${num(x.nfs.size)} nota(s)` }));
  const arms = anAgrupar(sai, r => r.arm || '—', anPl, x => ({ rot:x.k, sub:(nomeArmazem(x.k) || '').toLowerCase() }));
  const p1 = v => `${num1(v)} pl`;

  const bloco = (tit, nota, html) => `<div class="panel an-bloco"><div class="panel-head"><div><div class="section-title">${tit}</div><div class="section-note">${nota}</div></div></div><div class="panel-body">${html}</div></div>`;
  return heros + grafDia + anRitmoMes(met === 'valor' || met === 'nfs' || met === 'pl' || AN_UNS.includes(met) ? met : 'nfs') +
    `<div class="an-grade3">
      ${bloco('Tipo de saída', 'notas por tipo (pela TES)', anRanking(cats.map(c => ({ rot:c.rot, v:c.v })), v => num(v)))}
      ${bloco('Dia da semana', 'média de notas por dia trabalhado', anRanking(dow.filter(d => d.v), v => num1(v)))}
      ${bloco('Por filial', 'paletes expedidos', anRanking(fils, p1))}
    </div>
    <div class="an-grade2">
      ${bloco('Produtos que mais saíram', 'top 10 em paletes', anRanking(prods, p1))}
      ${bloco('Para onde vai', 'estados, em paletes', anRanking(ufs, p1))}
      ${bloco('Maiores clientes', 'top 10 em faturamento', anRanking(clis, anRc))}
      ${bloco('De onde sai', 'armazém da nota, em paletes', anRanking(arms.slice(0, 8), p1))}
    </div>
    <div class="panel"><div class="panel-head"><div><div class="section-title">Destaques do período</div><div class="section-note">o que os números dizem</div></div></div>
      <div class="panel-body"><ul class="an-dest">${anDestaques(ls, sai, o).map(t => `<li>${t}</li>`).join('') || '<li>Pouco movimento no período para tirar conclusões.</li>'}</ul></div></div>`;
}
function anVarCurto(a, b) {
  if (!b) return '';
  const p = (a - b) / b * 100;
  return Math.abs(p) < 0.5 ? '' : `<em class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'}${num(Math.round(Math.abs(p)))}%</em>`;
}

function anDestaques(ls, sai, o) {
  const out = [];
  const porDia = {};
  for (const r of sai) (porDia[String(r.emissao).slice(0, 10)] ||= new Set()).add(anNF(r));
  const dias = Object.entries(porDia).sort((a, b) => b[1].size - a[1].size);
  if (dias[0]) out.push(`Dia mais forte: <b>${AN_DOW[new Date(dias[0][0] + 'T12:00').getDay()]} ${saData(dias[0][0])}</b>, com ${num(dias[0][1].size)} nota(s).`);
  const tr = sai.filter(r => anCat(r) === 'Transferência entre filiais');
  if (tr.length) out.push(`Transferência entre filiais: ${num(new Set(tr.map(anNF)).size)} nota(s), ${num1(tr.reduce((s, r) => s + anPl(r), 0))} palete(s).`);
  const des = sai.filter(r => anCat(r) === 'Descarte');
  if (des.length) out.push(`Descarte: ${num(new Set(des.map(anNF)).size)} nota(s), ${anQtdTxt(anSoma(des))}.`);
  const bon = sai.filter(r => anCat(r) === 'Bonificação');
  if (bon.length) out.push(`Bonificação: ${num(new Set(bon.map(anNF)).size)} nota(s), ${anQtdTxt(anSoma(bon))}.`);
  const dev = ls.filter(r => /DEVOLU|^DEV\b/i.test(r.tes_desc || ''));
  if (dev.length) out.push(`Devoluções: ${num(new Set(dev.map(anNF)).size)} nota(s), ${anQtdTxt(anSoma(dev))}.`);
  const tri = anTransferencias(ls);
  const lib = tri.filter(t => t.rota === 'liberação da quarentena');
  if (lib.length) out.push(`Liberado da quarentena: ${num(lib.length)} lote(s), ${anQtdTxt(anSoma(lib.map(t => t.base)))}.`);
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
