/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · SALDO-ERP.JS
   Tela "Saldo" do painel. Junta duas coisas:
     · o saldo do ERP (estoque_ref — a planilha SB8_SALDOS_LOTES que o
       robô manda) em forma de planilha, com filtro em cada coluna como
       no Excel, cruzado com o mapa (quanto do lote está nas vagas);
     · as análises (totais, validade, lotes divididos, armazém ×
       validade, evolução e parados) e a aba Divergências, que é o
       antigo Saldo mapeado (saldo-mapeado.js, sem mudança de regra).
   Histórico: estoque_ref_dia e estoque_ref_lote
   (sql/migracao-saldo-historico.sql). Esta tela só lê.
   ═══════════════════════════════════════════════════════════════ */

const SA_UNS = ['L', 'KG', 'DS'];

/* Tipo do produto no Protheus (B1_TIPO). */
const SA_TIPOS = {
  PA:'Produto acabado', PI:'Produto intermediário', MP:'Matéria-prima', ME:'Mercadoria',
  EM:'Embalagem', MC:'Material de consumo', BN:'Beneficiamento', GG:'Gasto geral',
};

/* Faixas de validade (dias até vencer; negativo = já venceu). */
const SA_FAIXAS = [
  { id:'venc', rot:'Vencidos',        cls:'is-neg',  t:d => d !== null && d < 0 },
  { id:'30',   rot:'Vencem em até 30 dias', cls:'is-warn', t:d => d !== null && d >= 0 && d <= 30 },
  { id:'60',   rot:'31 a 60 dias',    cls:'is-alt',  t:d => d !== null && d > 30 && d <= 60 },
  { id:'90',   rot:'61 a 90 dias',    cls:'is-info', t:d => d !== null && d > 60 && d <= 90 },
  { id:'mais', rot:'Mais de 90 dias', cls:'',        t:d => d !== null && d > 90 },
  { id:'sem',  rot:'Sem validade',    cls:'',        t:d => d === null },
];

/* Armazém que não combina com a validade. Para mudar a regra
   (por exemplo, aceitar vencido no 48 — descarte), é aqui. */
const SA_REGRAS = [
  { id:'venc-fora', rot:'Vencido fora do D7',      cls:'t-neg',  t:l => l.dias !== null && l.dias < 0 && l.arm !== 'D7' },
  { id:'d7-valido', rot:'No D7 sem estar vencido', cls:'t-warn', t:l => l.arm === 'D7' && l.dias !== null && l.dias >= 0 },
];

const SA_ABAS = [
  ['planilha',     'Planilha'],
  ['divergencias', 'Mapa × sistema'],
  ['totais',       'Totais'],
  ['validade',     'Validade'],
  ['divididos',    'Lote em 2+ armazéns'],
  ['armazem',      'Armazém × validade'],
  ['evolucao',     'Evolução'],
  ['parados',      'Parados'],
];

/* Situação do lote na planilha, a partir do cálculo do Saldo mapeado. */
const SA_SIT_COR = { pos:'t-ok', neg:'t-neg', warn:'t-warn', info:'t-info', alt:'t-alt' };
const SA_NAO_MAPEAVEL = 'Armazém não mapeado';

const _sa = {
  ref:[], dia:null, lotes:null, erroDia:null, erroLotes:null,
  ok:false, foto:null,
  aba:'planilha', grupo:'armazem', faixa:'venc', regra:'', periodo:90, parado:30, semD7:true,
  inicioHist:null, graf:{},
  f:{},                          // filtros por coluna (como o filtro do Excel)
  ord:{ col:'desc', asc:true },  // ordenação da planilha
  visao:'lotes',                 // lotes | produtos
  abertos:new Set(),             // produtos abertos na visão por produto
  abertosL:new Set(),            // lotes abertos (onde está no mapa)
  mapaDe:null,                   // de qual cálculo/ocupação veio o cruzamento
};

const dSaldoErp = debounce(() => renderSaldoErp(), 140);

/* ═══════════ AUXILIARES ═══════════ */
function saUn(u) {
  const v = String(u || '').trim().toUpperCase();
  if (['LT', 'LTS', 'LITRO', 'LITROS'].includes(v)) return 'L';
  if (['KGS', 'QUILO', 'KILO'].includes(v)) return 'KG';
  if (['DOSE', 'DOSES'].includes(v)) return 'DS';
  return v || '—';
}
function saHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const saUTC = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
/* Dias entre hoje e a data (AAAA-MM-DD), sem fuso: 0 = vence hoje. */
function saDias(iso) { return Math.round((saUTC(iso) - saUTC(saHoje())) / 864e5); }
const saData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
const saQ = n => num(Math.round((Number(n) || 0) * 100) / 100);
const saPl = n => n == null ? '—' : num1(n);
function saOrdUn(a, b) {
  const ia = SA_UNS.indexOf(a), ib = SA_UNS.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b));
}
/* { L:{saldo,emp,lotes,pl,mapa,falta}, KG:… } da lista. */
function saPorUn(lista) {
  const o = {};
  for (const l of lista) {
    const u = o[l.un] ||= { saldo:0, emp:0, lotes:0, pl:0, temPl:false, mapa:0, falta:0, mapeavel:0 };
    u.saldo += l.saldo; u.emp += l.emp; u.lotes++;
    if (l.pl != null) { u.pl += l.pl; u.temPl = true; }
    if (l.falta != null) { u.mapeavel += Math.max(0, l.saldo); u.mapa += Math.min(l.noMapa || 0, Math.max(0, l.saldo)); u.falta += l.falta; }
  }
  return o;
}
/* "1.200 L · 300 KG" */
function saTxtUn(lista, campo = 'saldo') {
  const o = saPorUn(lista);
  const p = Object.keys(o).sort(saOrdUn).map(u => `${saQ(o[u][campo])} ${esc(u)}`);
  return p.length ? p.join(' · ') : '—';
}
function saArm(a) {
  const nome = nomeArmazem(a);
  const mapeado = typeof armMapeado === 'function' ? armMapeado(a) : true;
  return `<span class="tag ${mapeado ? 't-mute' : 't-mute sa-nmap'} t-mono" title="${esc((nome || 'armazém fora da lista') + (mapeado ? '' : ' · não fica no mapa'))}">${esc(a)}</span>`;
}
function saDiasTxt(d) {
  if (d === null) return '<span class="num-zero">—</span>';
  if (d < 0)  return `<span class="num-neg">venceu há ${num(-d)} d</span>`;
  if (d === 0) return '<span class="num-neg">vence hoje</span>';
  return d <= 30 ? `<span class="sa-warn">${num(d)} d</span>` : `${num(d)} d`;
}
function saProd(l) {
  return `<div>${esc(l.desc)}</div><div class="sub mono">${esc(l.cod)}${l.tipo !== '—' ? ` · ${esc(l.tipo)}` : ''}</div>`;
}
/* Vagas do mapa (drive-in e separação) onde o produto+lote está. */
function saVagas(l, max = 2) {
  const v = l.vagas || [];
  if (!v.length) return '<span class="num-zero">—</span>';
  const mostra = v.slice(0, max).map(p => `<span class="tag t-info t-mono">${esc(p)}</span>`).join('');
  return `<div class="chips sa-vagas">${mostra}${v.length > max ? `<span class="tag t-mute" title="${esc(v.slice(max).join(', '))}">+${v.length - max}</span>` : ''}</div>`;
}
function saSitTag(l) {
  if (!l.sitRot) return '<span class="num-zero">—</span>';
  return `<span class="tag ${l.sitCls}" title="${esc(l.sitExpl || '')}">${esc(l.sitRot)}</span>`;
}

/* ═══════════ COLUNAS DA PLANILHA ═══════════
   tipo: cat (lista de valores com caixinhas) · num · data
   v(): valor para filtrar/ordenar · td(): o que aparece na célula */
const SA_MAPA_EST = {
  ok:      { rot:'No mapa',         cls:'ok'      },
  parcial: { rot:'Em parte',        cls:'parcial' },
  fora:    { rot:'Fora do mapa',    cls:'fora'    },
  na:      { rot:'Não se aplica',   cls:'na'      },
};
function saMapaInd(l) {
  const e = SA_MAPA_EST[l.mapaEst] || SA_MAPA_EST.fora;
  const pc = l.mapaEst === 'na' || l.pctMapa == null ? '' : `${num(Math.floor(l.pctMapa))}%`;
  const deg = l.mapaEst === 'parcial' ? Math.round((l.pctMapa || 0) * 3.6) : 0;
  return `<span class="sa-ind ${e.cls}" title="${esc(e.rot)}${l.vagas?.length ? ' · ' + esc(l.vagas.join(', ')) : ''}">` +
    `<i style="--g:${deg}deg"></i><span>${pc || '—'}</span></span>`;
}
const SA_COLS = [
  { id:'mapaind', rot:'Mapa',       tipo:'cat',  v:l => (SA_MAPA_EST[l.mapaEst] || SA_MAPA_EST.fora).rot, td:saMapaInd, cls:'sa-c-ind' },
  // Ocultas por padrão as que já aparecem dentro de outra célula
  // (código, filial e tipo embaixo do produto; UM junto do saldo).
  { id:'filial', rot:'Filial',      tipo:'cat',  v:l => filialCurta(l.filial), td:l => badgeFilial(l.filial, l.cod), oculta:true },
  { id:'tipo',   rot:'Tipo',        tipo:'cat',  v:l => l.tipo, oculta:true },
  { id:'cod',    rot:'Código',      tipo:'cat',  v:l => l.cod, cls:'mono', oculta:true },
  { id:'desc',   rot:'Produto',     tipo:'cat',  v:l => l.desc, cls:'nome',
    td:l => `${esc(l.desc)}<div class="sub mono">${esc(l.cod)} · ${esc(filialCurta(l.filial))}${l.tipo !== '—' ? ` · ${esc(l.tipo)}` : ''}</div>` },
  { id:'un',     rot:'UM',          tipo:'cat',  v:l => l.un, oculta:true },
  { id:'lote',   rot:'Lote',        tipo:'cat',  v:l => l.lote || '(vazio)', cls:'mono' },
  { id:'fab',    rot:'Fabricação',  tipo:'data', v:l => l.fab, cls:'mono', td:l => saData(l.fab), oculta:true },
  { id:'val',    rot:'Validade',    tipo:'data', v:l => l.val, cls:'mono', faixas:true,
    td:l => `${l.dias !== null && l.dias < 0 ? `<span class="num-neg">${saData(l.val)}</span>` : l.dias !== null && l.dias <= 30 ? `<span class="sa-warn">${saData(l.val)}</span>` : saData(l.val)}` +
            (l.dias !== null ? `<div class="sub">${saDiasTxt(l.dias)}</div>` : '') },
  { id:'vida',   rot:'Dias de vida', tipo:'num', v:l => l.dias, td:l => saDiasTxt(l.dias), oculta:true },
  { id:'pvida',  rot:'% de vida',   tipo:'num',  v:l => l.pvida, td:l => l.pvida == null ? '—' : `${num1(l.pvida)}%`, oculta:true },
  { id:'arm',    rot:'Armazém',     tipo:'cat',  v:l => l.arm, td:l => saArm(l.arm) },
  { id:'saldo',  rot:'Saldo',       tipo:'num',  v:l => l.saldo, td:l => `<b>${saQ(l.saldo)}</b> <small class="sa-un">${esc(l.un)}</small>` },
  { id:'emp',    rot:'Empenho',     tipo:'num',  v:l => l.emp, td:l => l.emp ? saQ(l.emp) : '<span class="num-zero">—</span>', oculta:true },
  { id:'livre',  rot:'Livre',       tipo:'num',  v:l => l.saldo - l.emp, td:l => saQ(l.saldo - l.emp), oculta:true },
  { id:'pl',     rot:'Paletes',     tipo:'num',  v:l => l.pl, td:l => saPl(l.pl), oculta:true },
  { id:'cx',     rot:'Caixas',      tipo:'num',  v:l => l.cx, td:l => l.cx == null ? '—' : saQ(l.cx), oculta:true },
  { id:'mapa',   rot:'No mapa',     tipo:'num',  v:l => l.noMapa, td:l => l.falta == null && !l.noMapa ? '<span class="num-zero">—</span>' : saQ(l.noMapa), oculta:true },
  { id:'falta',  rot:'Falta mapear', tipo:'num', v:l => l.falta,
    td:l => l.falta == null ? '<span class="num-zero" title="Armazém que não fica no mapa">n/a</span>' : l.falta > 0 ? `<span class="sa-warn">${saQ(l.falta)}</span>` : '<span class="num-pos">0</span>' },
  { id:'sit',    rot:'Situação',    tipo:'cat',  v:l => l.sitRot || '—', td:saSitTag },
  { id:'vagas',  rot:'Vagas',       tipo:'cat',  v:l => (l.vagas || []).length ? l.vagas : ['(nenhuma)'], td:l => saVagas(l), multi:true },
];
const SA_COL = Object.fromEntries(SA_COLS.map(c => [c.id, c]));
const LS_COLS = 'saldo.colunas';
let _saVisiveis = (() => {
  try { const v = JSON.parse(localStorage.getItem(LS_COLS) || 'null'); if (Array.isArray(v) && v.length) return new Set(v); } catch { /* sem storage */ }
  return new Set(SA_COLS.filter(c => !c.oculta).map(c => c.id));
})();
function saGravarColunas() { try { localStorage.setItem(LS_COLS, JSON.stringify([..._saVisiveis])); } catch { /* sem storage */ } }

/* ═══════════ CARGA ═══════════
   O saldo do ERP e o mapa vêm do mesmo carregamento do Saldo mapeado
   (carregarSaldoMapa), assim a planilha e as Divergências usam a
   mesma foto e o mesmo cálculo. */
async function carregarSaldoErp(forcar = false) {
  if (_sa.ok && !forcar && cacheValido('saldo-erp', 120)) { renderSaldoErp(); return; }
  if (!_sa.ok) $('sa-corpo').innerHTML = '<div class="skeleton">carregando o saldo…</div>';
  const tenta = p => p.then(d => ({ d }), e => ({ e }));
  const desde = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const [, dia, lotes] = await Promise.all([
    carregarSaldoMapa(forcar || !_sa.ok),
    tenta(buscarTudo(() => sb.from('estoque_ref_dia')
      .select('dia, filial, armazem, unidade, tipo, saldo, empenho, vencido, paletes, lotes')
      .gte('dia', desde).order('dia').order('filial').order('armazem').order('unidade').order('tipo'))),
    tenta(buscarTudo(() => sb.from('estoque_ref_lote')
      .select('filial, codigo, lote, armazem, primeiro_visto, ultima_mudanca')
      .order('filial').order('codigo').order('lote').order('armazem'))),
  ]);

  // Uma linha por filial + código + lote + armazém (a planilha pode repetir).
  const m = new Map();
  let de = null, ate = null, quem = null;
  for (const r of (typeof linhasDeReferencia === 'function' ? linhasDeReferencia() : [])) {
    if (r.importado_em) {
      if (!de || r.importado_em < de) de = r.importado_em;
      if (!ate || r.importado_em > ate) { ate = r.importado_em; quem = r.importado_por; }
    }
    const cod = normalizarCodigo(r.codigo);
    if (!cod) continue;
    const lote = String(r.lote || '').trim().toUpperCase();
    const arm = normalizarArmazem(r.armazem) || '—';
    const fil = String(r.filial || '').trim();
    const k = `${fil}|${cod}|${lote}|${arm}`;
    let l = m.get(k);
    if (!l) {
      const val = r.dt_validade ? String(r.dt_validade).slice(0, 10) : null;
      const fab = r.dt_fabricacao ? String(r.dt_fabricacao).slice(0, 10) : null;
      const dias = val ? saDias(val) : null;
      const vida = val && fab ? (saUTC(val) - saUTC(fab)) / 864e5 : null;
      l = { k, filial:fil, cod, lote, arm,
            desc:String(r.descricao || '').replace(/\s+/g, ' ').trim() || produtoPorCodigo(cod)?.nome || cod,
            un:saUn(r.unidade || produtoPorCodigo(cod)?.unidade), tipo:String(r.tipo || '').trim().toUpperCase() || '—',
            val, fab, dias, pvida:vida > 0 ? Math.max(0, dias / vida * 100) : null,
            saldo:0, emp:0, pl:null, cx:null };
      m.set(k, l);
    }
    l.saldo += Number(r.saldo) || 0;
    l.emp   += Number(r.empenho) || 0;
    if (r.paletes != null && r.paletes !== '') l.pl = (l.pl || 0) + Number(r.paletes);
    if (r.caixas  != null && r.caixas  !== '') l.cx = (l.cx || 0) + Number(r.caixas);
  }
  _sa.ref = [...m.values()].filter(l => l.saldo !== 0 || l.emp !== 0);
  _sa.foto = de ? { de, ate, quem } : null;
  _sa.mapaDe = null;

  _sa.dia = dia.e ? null : dia.d;
  _sa.erroDia = dia.e || null;
  _sa.erroLotes = lotes.e || null;
  if (lotes.e) _sa.lotes = null;
  else {
    _sa.lotes = new Map();
    let ini = null;
    for (const x of lotes.d) {
      _sa.lotes.set(`${String(x.filial || '').trim()}|${x.codigo}|${x.lote}|${x.armazem}`, x);
      if (!ini || x.primeiro_visto < ini) ini = x.primeiro_visto;
    }
    const dIni = (_sa.dia || []).map(d => d.dia).sort()[0];
    _sa.inicioHist = [ini?.slice(0, 10), dIni].filter(Boolean).sort()[0] || null;
  }

  _sa.ok = true;
  cacheGravar('saldo-erp', true);
  renderSaldoErp();
}

/* Cruza cada linha do ERP com o mapa: quanto do lote está nas vagas
   do mesmo armazém, quais vagas, e a situação que as Divergências dão.
   Refaz só quando o cálculo do Saldo mapeado ou o mapa mudaram. */
function saCruzarMapa() {
  const calc = typeof _sCalc !== 'undefined' ? _sCalc : null;
  const ocup = typeof _sOcup !== 'undefined' ? _sOcup : null;
  if (_sa.mapaDe && _sa.mapaDe.calc === calc && _sa.mapaDe.ocup === ocup) return;
  _sa.mapaDe = { calc, ocup };

  const kc = (cod, lote) => `${chave(normalizarCodigo(cod))}|${chave(lote)}`;
  // mapa: produto+lote+armazém → quantidade; produto+lote → vagas
  const qtd = new Map(), vagas = new Map(), itensK = new Map();
  for (const [pos, itens] of Object.entries(ocup || {}))
    for (const it of itens) {
      const k = kc(it.codigo, it.lote);
      const ka = `${k}|${normalizarArmazem(it.armazem)}`;
      qtd.set(ka, (qtd.get(ka) || 0) + (Number(it.quantidade) || 0));
      const v = vagas.get(k) || vagas.set(k, []).get(k);
      if (!v.includes(pos)) v.push(pos);
      (itensK.get(k) || itensK.set(k, []).get(k)).push({ pos, qtd:Number(it.quantidade) || 0,
        arm:normalizarArmazem(it.armazem) || '—', desde:it.created_at, sep:!!it.sep });
    }
  for (const v of vagas.values()) v.sort();
  for (const v of itensK.values()) v.sort((a, b) => a.pos.localeCompare(b.pos, 'pt-BR', { numeric:true }));

  // situação: a linha das Divergências que tem este lote+armazém do sistema
  const sit = new Map();
  for (const l of calc?.lista || []) {
    if (l.sistema === null) continue;
    for (const a of l.armsSis) {
      const k = `${l.kc}|${a}`;
      const normal = l.k === k;
      if (!sit.has(k) || normal) sit.set(k, l);
    }
  }

  for (const r of _sa.ref) {
    const k = kc(r.cod, r.lote), ka = `${k}|${r.arm}`;
    r.vagas = vagas.get(k) || [];
    r.itensMapa = itensK.get(k) || [];
    r._busca = null;                       // a busca também acha pela vaga
    r.noMapa = qtd.get(ka) || 0;
    r.pctMapa = r.saldo > 0 ? Math.min(100, r.noMapa / r.saldo * 100) : null;
    const mapeavel = typeof armMapeado === 'function' ? armMapeado(r.arm) : true;
    r.linhaDiv = null;
    if (!mapeavel) {
      r.falta = null; r.sitRot = SA_NAO_MAPEAVEL; r.sitCls = 't-mute'; r.mapaEst = 'na';
      r.sitExpl = 'Este armazém não fica no drive-in; o saldo dele não precisa estar no mapa.';
      r.sitId = 'nmap';
      continue;
    }
    r.falta = Math.max(0, r.saldo - r.noMapa);
    const l = sit.get(ka);
    r.linhaDiv = l || null;
    const id = l?.estado || (r.saldo <= 0 ? null : r.noMapa ? (r.falta > 0.001 ? 'falta' : 'ok') : 'nao-mapeado');
    const s = id && typeof SITUACOES === 'object' ? SITUACOES[id] : null;
    r.sitId = id;
    r.sitRot = s?.rot || (id ? id : '');
    r.sitCls = SA_SIT_COR[s?.cor] || 't-mute';
    r.sitExpl = s?.expl || '';
    // Resumo para o indicador: está no mapa, em parte ou não está.
    // (pela quantidade: sobra no mapa também é "no mapa"; a Situação avisa da sobra)
    r.mapaEst = r.saldo <= 0 ? 'ok' : r.noMapa >= r.saldo - Math.max(0.001, r.saldo * 0.0002) ? 'ok' : r.noMapa > 0.001 ? 'parcial' : 'fora';
  }
}

/* ═══════════ FILTROS (como o filtro do Excel) ═══════════
   _sa.f[col] =
     cat:  { vals:Set }                    só os valores marcados
     num:  { min, max, zero:'nz'|'z'|'' }
     data: { faixas:Set, de, ate }
   Um filtro vale em todas as abas (menos Divergências, que tem os dela). */
function saTemFiltro(id) { return !!_sa.f[id]; }
function saPassaCol(l, id) {
  const f = _sa.f[id]; if (!f) return true;
  const c = SA_COL[id], v = c.v(l);
  if (c.tipo === 'cat') return c.multi ? v.some(x => f.vals.has(String(x))) : f.vals.has(String(v ?? '—'));
  if (c.tipo === 'num') {
    if (f.zero === 'nz' && !(v != null && Math.abs(v) > 1e-9)) return false;
    if (f.zero === 'z'  && v != null && Math.abs(v) > 1e-9) return false;
    if (f.min !== null && f.min !== undefined && !(v != null && v >= f.min)) return false;
    if (f.max !== null && f.max !== undefined && !(v != null && v <= f.max)) return false;
    return true;
  }
  if (c.tipo === 'data') {
    if (f.faixas?.size) {
      const d = v ? saDias(v) : null;
      if (![...f.faixas].some(id2 => SA_FAIXAS.find(x => x.id === id2)?.t(d))) return false;
    }
    if (f.de  && !(v && v >= f.de))  return false;
    if (f.ate && !(v && v <= f.ate)) return false;
    return true;
  }
  return true;
}
function saBuscaTxt(l) {
  return l._busca ??= `${l.cod} ${l.desc} ${l.lote} ${l.arm} ${(l.vagas || []).join(' ')}`.toUpperCase();
}
/* Linhas que passam na filial do topo, na busca e nos filtros de coluna.
   `sem` ignora o filtro de uma coluna (para a lista de valores dela e
   para o lote dividido ver os outros armazéns). */
function saFiltradas(sem = '') {
  saCruzarMapa();
  const ts = termos($('sa-busca')?.value || '');
  const cols = Object.keys(_sa.f).filter(id => id !== sem);
  return _sa.ref.filter(l =>
    daFilial(l.filial) &&
    (!ts.length || ts.some(t => saBuscaTxt(l).includes(t))) &&
    cols.every(id => saPassaCol(l, id)));
}
function saAssin() {
  return [$('filtro-filial').value, $('sa-busca')?.value, JSON.stringify(_sa.f, (k, v) => v instanceof Set ? [...v] : v)].join('|');
}
function saChips() {
  const out = [];
  const q = $('sa-busca')?.value.trim();
  if (q) out.push(`<span class="fchip">busca: <b>${esc(q)}</b><button onclick="$('sa-busca').value='';renderSaldoErp()" aria-label="Tirar a busca">×</button></span>`);
  for (const [id, f] of Object.entries(_sa.f)) {
    const c = SA_COL[id];
    let txt;
    if (c.tipo === 'cat') { const v = [...f.vals]; txt = v.length <= 3 ? v.join(', ') : `${v.slice(0, 2).join(', ')} +${v.length - 2}`; }
    else if (c.tipo === 'num') txt = [f.zero === 'nz' ? '≠ 0' : f.zero === 'z' ? '= 0' : '', f.min != null ? `≥ ${num(f.min)}` : '', f.max != null ? `≤ ${num(f.max)}` : ''].filter(Boolean).join(' e ');
    else txt = [[...(f.faixas || [])].map(x => SA_FAIXAS.find(y => y.id === x)?.rot).join(', '), f.de ? `de ${saData(f.de)}` : '', f.ate ? `até ${saData(f.ate)}` : ''].filter(Boolean).join(' · ');
    out.push(`<span class="fchip">${esc(c.rot)}: <b>${esc(txt)}</b><button onclick="saTirarFiltro('${id}')" aria-label="Tirar o filtro de ${esc(c.rot)}">×</button></span>`);
  }
  if (out.length > 1) out.push(`<button class="btn btn-ghost btn-sm" onclick="saLimparFiltros()">Limpar filtros</button>`);
  $('sa-chips').innerHTML = out.join('');
}
function saTirarFiltro(id) { delete _sa.f[id]; renderSaldoErp(); }

/* ── filtros rápidos: atalhos que preenchem o filtro de uma coluna ── */
const SA_DIVERG = () => ['armazem', 'codigo', 'produto', 'sobra', 'lote']
  .map(id => typeof SITUACOES === 'object' ? SITUACOES[id]?.rot : null).filter(Boolean);
const SA_RAPIDOS = [
  { id:'venc',   grupo:'Validade', rot:'Vencidos',          col:'val',     f:() => ({ faixas:new Set(['venc']) }) },
  { id:'v30',    grupo:'Validade', rot:'Vencem em 30 dias', col:'val',     f:() => ({ faixas:new Set(['30']) }) },
  { id:'v60',    grupo:'Validade', rot:'em 60 dias',        col:'val',     f:() => ({ faixas:new Set(['30', '60']) }) },
  { id:'v90',    grupo:'Validade', rot:'em 90 dias',        col:'val',     f:() => ({ faixas:new Set(['30', '60', '90']) }) },
  { id:'faltam', grupo:'Mapa',     rot:'Falta mapear',      col:'mapaind', f:() => ({ vals:new Set([SA_MAPA_EST.fora.rot, SA_MAPA_EST.parcial.rot]) }) },
  { id:'fora',   grupo:'Mapa',     rot:'Fora do mapa',      col:'mapaind', f:() => ({ vals:new Set([SA_MAPA_EST.fora.rot]) }) },
  { id:'parte',  grupo:'Mapa',     rot:'Mapeado em parte',  col:'mapaind', f:() => ({ vals:new Set([SA_MAPA_EST.parcial.rot]) }) },
  { id:'nomapa', grupo:'Mapa',     rot:'Tudo no mapa',      col:'mapaind', f:() => ({ vals:new Set([SA_MAPA_EST.ok.rot]) }) },
  { id:'diverg', grupo:'Mapa',     rot:'Com divergência',   col:'sit',     f:() => ({ vals:new Set(SA_DIVERG()) }) },
  { id:'emp',    grupo:'Outros',   rot:'Com empenho',       col:'emp',     f:() => ({ min:null, max:null, zero:'nz' }) },
  { id:'livre0', grupo:'Outros',   rot:'Todo empenhado',    col:'livre',   f:() => ({ min:null, max:0, zero:'' }) },
];
const saSerial = f => JSON.stringify(f, (k, v) => v instanceof Set ? [...v].sort() : v);
function saRapidoAtivo(id) {
  const r = SA_RAPIDOS.find(x => x.id === id);
  return !!r && !!_sa.f[r.col] && saSerial(_sa.f[r.col]) === saSerial(r.f());
}
function saRapido(id) {
  const r = SA_RAPIDOS.find(x => x.id === id); if (!r) return;
  if (saRapidoAtivo(id)) delete _sa.f[r.col]; else _sa.f[r.col] = r.f();
  if (_sa.aba === 'divergencias') _sa.aba = 'planilha';
  renderSaldoErp();
}
function saCartao(id) {
  if (id === 'arrumar') { saAba('armazem'); return; }
  _sa.aba = 'planilha';
  saRapido(id);
}
function saRapidosHTML() {
  const grupos = [...new Set(SA_RAPIDOS.map(r => r.grupo))];
  $('sa-rapidos').innerHTML = grupos.map(g => `<div class="sa-rap-g"><span>${esc(g)}</span>${SA_RAPIDOS.filter(r => r.grupo === g).map(r =>
    `<button class="sa-rap${saRapidoAtivo(r.id) ? ' on' : ''}" aria-pressed="${saRapidoAtivo(r.id)}" onclick="saRapido('${r.id}')">${esc(r.rot)}</button>`).join('')}</div>`).join('');
}
function saLimparFiltros() { _sa.f = {}; if ($('sa-busca')) $('sa-busca').value = ''; renderSaldoErp(); }
/* Atalho das análises: clicar num armazém, tipo ou filial filtra a tela. */
function saFiltrarValor(id, v) {
  _sa.f[id] = { vals:new Set([String(v)]) };
  renderSaldoErp();
  toast(`Filtrando ${SA_COL[id].rot}: ${v}.`);
}

/* Lotes em mais de um armazém (mesma filial, código e lote). */
function saDivididos() {
  const fArm = _sa.f.arm;
  const g = new Map();
  for (const l of saFiltradas('arm')) {
    if (l.saldo <= 0) continue;
    const k = `${l.filial}|${l.cod}|${l.lote}`;
    (g.get(k) || g.set(k, []).get(k)).push(l);
  }
  return [...g.values()]
    .filter(ls => ls.length > 1 && (!fArm || ls.some(l => saPassaCol(l, 'arm'))))
    .map(ls => ({ ls:ls.sort((a, b) => b.saldo - a.saldo), l:ls[0], total:ls.reduce((s, l) => s + l.saldo, 0) }))
    .sort((a, b) => b.ls.length - a.ls.length || a.l.desc.localeCompare(b.l.desc) || a.l.lote.localeCompare(b.l.lote));
}
function saForaDaRegra(lista) {
  const out = [];
  for (const l of lista) {
    const r = SA_REGRAS.find(x => x.t(l));
    if (r) out.push({ l, r });
  }
  return out;
}
function saParados(lista) {
  if (!_sa.lotes) return [];
  const agora = Date.now();
  const ini = _sa.inicioHist;
  return lista.map(l => {
    const x = _sa.lotes.get(l.k);
    if (!x || l.saldo <= 0) return null;
    const dias = Math.floor((agora - new Date(x.ultima_mudanca).getTime()) / 864e5);
    // Sem mudança desde o primeiro dia do histórico: pode estar parado há mais tempo.
    const desdeInicio = ini && String(x.ultima_mudanca).slice(0, 10) <= ini;
    return { l, dias, desde:x.ultima_mudanca, desdeInicio };
  }).filter(Boolean);
}

/* ═══════════ RENDER ═══════════ */
function renderSaldoErp() {
  if (!_sa.ok || !$('page-saldo')) return;
  saFecharPop();
  const lista = saFiltradas();
  const naDiv = _sa.aba === 'divergencias';

  // Cabeçalho: de quando é a foto.
  const f = _sa.foto;
  $('sa-foto').innerHTML = f
    ? `Foto do ERP de <b>${esc(fmtTS(f.ate))}</b> <span class="sa-mute">(${esc(haQuanto(new Date(f.ate).getTime()))})</span>${f.quem ? ` · ${esc(f.quem)}` : ''}` +
      (new Date(f.ate) - new Date(f.de) > 36e5 ? ` <span class="sa-mute">(algum armazém é de ${esc(fmtTS(f.de))})</span>` : '')
    : 'Nenhuma foto do ERP ainda.';

  // Avisos
  const av = [];
  if (!_sa.ref.length) av.push(`<div class="aviso a-info"><span class="aviso-ico">◔</span><div><b>Sem saldo do ERP</b>
    O robô do Excel ainda não mandou a foto. Para mandar à mão: menu ⋯ → Importar planilha do ERP.</div></div>`);
  if (_sa.erroDia || _sa.erroLotes) av.push(`<div class="aviso a-warn"><span class="aviso-ico">!</span><div><b>Histórico ainda não ligado</b>
    Rode o <b>sql/migracao-saldo-historico.sql</b> no Supabase. Sem ele não aparecem a evolução diária e os lotes parados; o resto da tela funciona.</div></div>`);
  $('sa-avisos').innerHTML = naDiv ? '' : av.join('');

  // Resumo: o saldo por unidade numa tabela (litro, quilo e dose não se
  // somam) e, ao lado, os cartões que viram filtro quando clicados.
  const pu = saPorUn(lista);
  const venc = lista.filter(l => l.dias !== null && l.dias < 0 && l.saldo > 0);
  const v90  = lista.filter(l => l.dias !== null && l.dias >= 0 && l.dias <= 90 && l.saldo > 0);
  const div = saDivididos().length;
  const fora = saForaDaRegra(lista).length;
  const mapeaveis = lista.filter(l => l.falta != null && l.saldo > 0);
  const completos = mapeaveis.filter(l => l.mapaEst === 'ok').length;
  const faltam = mapeaveis.filter(l => l.mapaEst !== 'ok');
  const filtrando = Object.keys(_sa.f).length || $('sa-busca').value.trim() || $('filtro-filial').value;
  const uns = Object.keys(pu).sort(saOrdUn);
  const linhaUn = u => { const x = pu[u], pc = x.mapeavel ? Math.min(100, x.mapa / x.mapeavel * 100) : null;
    return `<tr><td><span class="tag t-mute">${esc(u)}</span></td><td class="num"><b>${saQ(x.saldo)}</b></td>
      <td class="num">${saQ(x.saldo - x.emp)}</td><td class="num">${x.emp ? saQ(x.emp) : '—'}</td><td class="num">${x.temPl ? num1(x.pl) : '—'}</td>
      <td>${pc === null ? '<span class="num-zero">n/a</span>' : `<div class="k-pbar"><div class="bar ${pc >= 99.98 ? 'pos' : ''}"><i style="width:${pc.toFixed(1)}%"></i></div><span>${num1(pc)}%</span></div>`}</td></tr>`; };
  const cartao = (id, rot, valor, pe, cls, ativo) =>
    `<button class="kpi sa-kpi ${cls}${ativo ? ' sel' : ''}" onclick="saCartao('${id}')" aria-pressed="${!!ativo}">
      <div class="kpi-label">${esc(rot)}</div><div class="kpi-value">${valor}</div><div class="kpi-foot">${pe}</div></button>`;
  $('sa-kpis').innerHTML = `
    <div class="panel sa-res-un">
      <div class="sa-res-tit">Saldo${filtrando ? ' <span>com os filtros</span>' : ''}<small>${num(lista.length)} lote(s)</small></div>
      <div class="sa-res-scroll"><table class="sa-res-t">
        <thead><tr><th>UM</th><th class="num">Saldo</th><th class="num">Livre</th><th class="num">Empenhado</th><th class="num">Paletes</th><th>No mapa</th></tr></thead>
        <tbody>${uns.map(linhaUn).join('') || '<tr><td colspan="6" class="num-zero">sem saldo</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="sa-cartoes">
      ${cartao('faltam', 'Lotes no mapa', mapeaveis.length ? `${num1(completos / mapeaveis.length * 100)}<small>%</small>` : '—',
        faltam.length ? `${num(completos)} de ${num(mapeaveis.length)} · <b>${num(faltam.length)} faltam mapear</b>` : 'todo o saldo está no mapa',
        faltam.length ? 'is-info' : 'is-pos', saRapidoAtivo('faltam'))}
      ${cartao('venc', 'Lotes vencidos', num(venc.length), venc.length ? saTxtUn(venc) : 'nenhum lote vencido', venc.length ? 'is-neg' : 'is-pos', saRapidoAtivo('venc'))}
      ${cartao('v90', 'Vencem em 90 dias', num(v90.length), v90.length ? saTxtUn(v90) : 'nenhum', v90.length ? 'is-warn' : '', saRapidoAtivo('v90'))}
      ${cartao('arrumar', 'Para arrumar', num(div + fora), `${num(div)} em 2+ armazéns · ${num(fora)} no armazém errado`, div + fora ? 'is-alt' : 'is-pos', false)}
    </div>`;
  saRapidosHTML();

  // Abas com contagem
  const nDiv = (typeof _sCalc !== 'undefined' && _sCalc?.lista) ? _sCalc.lista.filter(l => l.estado !== 'ok').length : 0;   // = o botão Divergentes da aba
  const n = {
    divergencias: nDiv, validade: venc.length, divididos: div, armazem: fora,
    parados: _sa.lotes ? saParados(lista).filter(p => p.dias >= _sa.parado && !(_sa.semD7 && p.l.arm === 'D7')).length : null,
  };
  $('sa-abas').innerHTML = SA_ABAS.map(([id, rot]) =>
    `<button role="tab" aria-selected="${_sa.aba === id}" class="${_sa.aba === id ? 'active' : ''}" onclick="saAba('${id}')">${esc(rot)}` +
    `${n[id] ? ` <span class="sa-n${id === 'validade' || id === 'divergencias' ? ' neg' : ''}">${num(n[id])}</span>` : ''}</button>`).join('');
  $('sa-abas').querySelector('.active')?.scrollIntoView({ block:'nearest', inline:'nearest' });

  // Divergências: a tela antiga do Saldo mapeado, com os filtros dela.
  $('sa-geral').hidden = naDiv;
  $('sa-div').hidden = !naDiv;
  $('sa-filtros').hidden = naDiv;
  $('sa-kpis').hidden = naDiv;
  if (naDiv) return;
  saChips();

  ({ planilha:saPlanilha, totais:saTotais, validade:saValidade, divididos:saDivTab, armazem:saArmTab, evolucao:saEvolucao, parados:saParadosTab })[_sa.aba](lista);
}

/* "Atualizar" relê do banco tudo o que a tela mostra (saldo, mapa e
   histórico), sem esperar o cache. Quem traz saldo novo do ERP para o
   banco é o robô do Excel, no horário dele. */
async function saAtualizar() {
  busy('sa-bt-atu', 'sa-spin-atu', true);
  try {
    if (typeof cacheInvalidar === 'function') cacheInvalidar('saldo-erp');
    await carregarSaldoErp(true);
    toast(_sa.foto ? `Recarregado. A foto mais nova do ERP é de ${fmtTS(_sa.foto.ate)}.` : 'Recarregado.');
  } finally { busy('sa-bt-atu', 'sa-spin-atu', false); }
}

function saAba(id) { _sa.aba = id; _sa.export = null; renderSaldoErp(); }
function saSet(campo, v) { _sa[campo] = v; renderSaldoErp(); }

function saCtrlSeg(campo, opcoes, rotulo) {
  return `<div class="sa-ctrl"><span>${esc(rotulo)}</span><div class="seg">${opcoes.map(([v, t]) =>
    `<button class="${String(_sa[campo]) === String(v) ? 'active' : ''}" onclick="saSet('${campo}', ${typeof v === 'number' ? v : `'${v}'`})">${esc(t)}</button>`).join('')}</div></div>`;
}

/* ═══════════ PLANILHA ═══════════ */
function saOrdenarLista(ls) {
  const c = SA_COL[_sa.ord.col] || SA_COL.desc, dir = _sa.ord.asc ? 1 : -1;
  const val = l => { const v = c.v(l); return Array.isArray(v) ? v.length : v; };
  return [...ls].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;                    // vazio vai para o fim nos dois sentidos
    if (vb == null) return -1;
    const r = typeof va === 'number' && typeof vb === 'number' ? va - vb
      : String(va).localeCompare(String(vb), 'pt-BR', { numeric:true });
    return r * dir || a.desc.localeCompare(b.desc) || a.lote.localeCompare(b.lote) || a.arm.localeCompare(b.arm);
  });
}
function saOrdenar(id, asc) {
  if (asc === undefined) asc = _sa.ord.col === id ? !_sa.ord.asc : SA_COL[id].tipo !== 'num';
  _sa.ord = { col:id, asc };
  saFecharPop();
  renderSaldoErp();
}
function saTh(c) {
  const ord = _sa.ord.col === c.id ? (_sa.ord.asc ? ' ↑' : ' ↓') : '';
  return `<th class="sa-th${c.tipo === 'num' ? ' num' : ''}${saTemFiltro(c.id) ? ' filtrado' : ''}">
    <div class="sa-th-in">
      <button class="sa-th-rot" onclick="saOrdenar('${c.id}')" title="Ordenar por ${esc(c.rot)}">${esc(c.rot)}${ord}</button>
      <button class="sa-th-f" onclick="saAbrirFiltro(event, '${c.id}')" aria-label="Filtrar ${esc(c.rot)}" title="Filtrar ${esc(c.rot)}">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z" fill="${saTemFiltro(c.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      </button>
    </div></th>`;
}
function saTotaisLinha(ls) {
  const o = saPorUn(ls);
  const uns = Object.keys(o).sort(saOrdUn);
  if (!uns.length) return '';
  return `<div class="sa-somas">${uns.map(u => { const x = o[u];
    return `<div class="sa-soma"><span class="tag t-mute">${esc(u)}</span>
      <span>saldo <b>${saQ(x.saldo)}</b></span><span>empenho <b>${saQ(x.emp)}</b></span><span>livre <b>${saQ(x.saldo - x.emp)}</b></span>
      ${x.mapeavel ? `<span>no mapa <b>${saQ(x.mapa)}</b> (${num1(x.mapa / x.mapeavel * 100)}%)</span><span>falta mapear <b class="${x.falta > 0 ? 'sa-warn' : ''}">${saQ(x.falta)}</b></span>` : ''}
      ${x.temPl ? `<span><b>${num1(x.pl)}</b> pl</span>` : ''}</div>`; }).join('')}</div>`;
}
function saPlanilha(lista) {
  $('sa-ctrl').innerHTML = saCtrlSeg('visao', [['lotes', 'Lotes'], ['produtos', 'Produtos']], 'Ver por') +
    `<div class="sa-cols-wrap"><button class="btn btn-ghost btn-sm" onclick="saAbrirColunas(event)">Colunas</button></div>`;
  const cols = SA_COLS.filter(c => _saVisiveis.has(c.id));
  if (_sa.visao === 'produtos') return saPlanilhaProdutos(lista);

  const ls = saOrdenarLista(lista);
  _sa.export = () => ls.map(l => Object.fromEntries(cols.map(c => {
    const v = c.v(l);
    return [c.rot, Array.isArray(v) ? (l.vagas || []).join(' ') : c.tipo === 'data' ? saData(v).replace('—', '') : v ?? ''];
  })));
  const p = fatiar('sa-pla', ls, saAssin() + JSON.stringify(_sa.ord));
  _sa.regLote = p.itens;
  $('sa-corpo').innerHTML = `
    <div class="tbl-wrap"><table class="sa-grade">
      <thead><tr>${cols.map(saTh).join('')}</tr></thead>
      <tbody>${p.itens.map((l, i) => {
        const aberto = _sa.abertosL.has(l.k);
        return `<tr class="sa-lin${aberto ? ' aberto' : ''}" onclick="saAbrirLote(${i})" title="Clique para ver onde está no mapa">${cols.map(c =>
          `<td class="${c.tipo === 'num' ? 'num' : c.cls || ''}">${c.td ? c.td(l) : esc(c.v(l) ?? '—')}</td>`).join('')}</tr>` +
          (aberto ? `<tr class="sa-det"><td colspan="${cols.length}">${saDetalheLote(l)}</td></tr>` : '');
      }).join('') || vazio('Nenhum lote com esses filtros', Object.keys(_sa.f).length ? 'Tire algum filtro ali em cima.' : '', cols.length)}</tbody>
    </table></div>${barraPag('sa-pla', p, 'lote(s)')}`;
}

/* Uma linha por produto (filial + código), com os lotes embaixo. */
function saPlanilhaProdutos(lista) {
  const g = new Map();
  for (const l of lista) {
    const k = `${l.filial}|${l.cod}`;
    let x = g.get(k);
    if (!x) g.set(k, x = { k, l, ls:[], saldo:0, emp:0, pl:null, mapa:0, falta:0, mapeavel:0, venc:0 });
    x.ls.push(l); x.saldo += l.saldo; x.emp += l.emp;
    if (l.pl != null) x.pl = (x.pl || 0) + l.pl;
    if (l.falta != null) { x.mapeavel += Math.max(0, l.saldo); x.mapa += Math.min(l.noMapa, Math.max(0, l.saldo)); x.falta += l.falta; }
    if (l.dias !== null && l.dias < 0 && l.saldo > 0) x.venc++;
  }
  const c = _sa.ord.col, dir = _sa.ord.asc ? 1 : -1;
  const chaveP = { saldo:x => x.saldo, emp:x => x.emp, livre:x => x.saldo - x.emp, pl:x => x.pl ?? -1, mapa:x => x.mapa, falta:x => x.falta,
                   cod:x => x.l.cod, filial:x => filialCurta(x.l.filial), tipo:x => x.l.tipo, un:x => x.l.un }[c];
  const gs = [...g.values()].sort((a, b) => {
    const r = chaveP ? (typeof chaveP(a) === 'number' ? chaveP(a) - chaveP(b) : String(chaveP(a)).localeCompare(String(chaveP(b)), 'pt-BR')) : a.l.desc.localeCompare(b.l.desc, 'pt-BR');
    return (chaveP ? r * dir : (c === 'desc' ? r * dir : r)) || a.l.desc.localeCompare(b.l.desc, 'pt-BR');
  });
  _sa.export = () => gs.map(x => ({ Filial:filialCurta(x.l.filial), Tipo:x.l.tipo, Codigo:x.l.cod, Produto:x.l.desc, UM:x.l.un, Lotes:x.ls.length,
    Saldo:x.saldo, Empenho:x.emp, Livre:x.saldo - x.emp, Paletes:x.pl ?? '', 'No mapa':x.mapa, 'Falta mapear':x.falta,
    '% no mapa':x.mapeavel ? Math.round(x.mapa / x.mapeavel * 1000) / 10 : '' }));
  const p = fatiar('sa-pla', gs, saAssin() + 'prod' + JSON.stringify(_sa.ord));
  _sa.regProd = p.itens;
  const th = (id, rot, num = false) => `<th class="${num ? 'num' : ''}"><button class="sa-th-rot" onclick="saOrdenar('${id}')">${esc(rot)}${_sa.ord.col === id ? (_sa.ord.asc ? ' ↑' : ' ↓') : ''}</button></th>`;
  const linhas = p.itens.map((x, i) => {
    const aberto = _sa.abertos.has(x.k);
    const pc = x.mapeavel ? Math.min(100, x.mapa / x.mapeavel * 100) : null;
    const sub = aberto ? `<tr class="sa-sub"><td colspan="11"><table class="sa-sub-t">
      <thead><tr><th>Mapa</th><th>Lote</th><th>Armazém</th><th>Validade</th><th class="num">Saldo</th><th class="num">Empenho</th><th class="num">No mapa</th><th class="num">Falta</th><th>Situação</th><th>Vagas</th></tr></thead>
      <tbody>${saOrdenarLista(x.ls).map(l => `<tr><td>${saMapaInd(l)}</td><td class="mono">${esc(l.lote || '—')}</td><td>${saArm(l.arm)}</td><td class="mono">${SA_COL.val.td(l)}</td>
        <td class="num">${saQ(l.saldo)}</td><td class="num">${l.emp ? saQ(l.emp) : '—'}</td><td class="num">${SA_COL.mapa.td(l)}</td><td class="num">${SA_COL.falta.td(l)}</td>
        <td>${saSitTag(l)}</td><td>${saVagas(l)}</td></tr>`).join('')}</tbody></table></td></tr>` : '';
    return `<tr class="sa-prod${aberto ? ' aberto' : ''}" onclick="saAbrirProduto(${i})">
      <td class="nome"><span class="sa-seta">${aberto ? '▾' : '▸'}</span>${esc(x.l.desc)}<div class="sub mono">${esc(x.l.cod)} · ${esc(x.l.tipo)}</div></td>
      <td>${badgeFilial(x.l.filial, x.l.cod)}</td><td>${esc(x.l.un)}</td>
      <td class="num">${num(x.ls.length)}${x.venc ? `<div class="sub num-neg">${num(x.venc)} vencido(s)</div>` : ''}</td>
      <td class="num"><b>${saQ(x.saldo)}</b></td><td class="num">${x.emp ? saQ(x.emp) : '—'}</td><td class="num">${saQ(x.saldo - x.emp)}</td>
      <td class="num">${saPl(x.pl)}</td><td class="num">${x.mapeavel ? saQ(x.mapa) : '—'}</td>
      <td class="num">${x.mapeavel ? (x.falta > 0.001 ? `<span class="sa-warn">${saQ(x.falta)}</span>` : '<span class="num-pos">0</span>') : '<span class="num-zero">n/a</span>'}</td>
      <td>${pc === null ? '<span class="num-zero">—</span>' : `<div class="k-pbar"><div class="bar ${pc >= 99.98 ? 'pos' : ''}"><i style="width:${pc.toFixed(1)}%"></i></div><span>${num1(pc)}%</span></div>`}</td>
    </tr>${sub}`;
  }).join('');
  $('sa-corpo').innerHTML = `
    <div class="tbl-wrap"><table class="sa-grade sa-prods">
      <thead><tr>${th('desc', 'Produto')}${th('filial', 'Filial')}${th('un', 'UM')}<th class="num">Lotes</th>${th('saldo', 'Saldo', true)}${th('emp', 'Empenho', true)}${th('livre', 'Livre', true)}${th('pl', 'Paletes', true)}${th('mapa', 'No mapa', true)}${th('falta', 'Falta mapear', true)}<th>% no mapa</th></tr></thead>
      <tbody>${linhas || vazio('Nenhum produto com esses filtros', '', 11)}</tbody>
    </table></div>${barraPag('sa-pla', p, 'produto(s)')}`;
}
function saAbrirLote(i) {
  const l = _sa.regLote?.[i]; if (!l) return;
  if (getSelection()?.toString()) return;      // estava selecionando texto
  _sa.abertosL.has(l.k) ? _sa.abertosL.delete(l.k) : _sa.abertosL.add(l.k);
  renderSaldoErp();
}
/* Onde o lote está: as vagas com a quantidade de cada uma e o que as
   Divergências dizem dele. */
function saDetalheLote(l) {
  const itens = l.itensMapa || [];
  const total = itens.reduce((s, x) => s + x.qtd, 0);
  const vagas = itens.length ? `<div class="sa-det-vagas">${itens.map(x => `
      <div class="sa-vaga">
        <div class="sa-vaga-pos">${esc(x.pos)}</div>
        <div class="sa-vaga-q"><b>${saQ(x.qtd)}</b> ${esc(l.un)} · arm. ${esc(x.arm)}${x.arm !== l.arm && l.arm !== '—' ? ' <span class="tag t-alt">outro armazém</span>' : ''}</div>
        <div class="sa-vaga-d">${x.sep ? 'área de separação' : x.desde ? `desde ${fmtDia(x.desde)}` : ''}</div>
        ${x.sep ? '' : `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();irParaVaga('${esc(x.pos)}')">Ver no mapa</button>`}
      </div>`).join('')}</div>`
    : `<div class="sa-det-vazio">Este lote não está em nenhuma vaga do mapa.</div>`;
  const resumo = l.mapaEst === 'na'
    ? `O armazém <b>${esc(l.arm)}</b> não fica no drive-in, então este saldo não precisa estar no mapa.`
    : `Sistema <b>${saQ(l.saldo)} ${esc(l.un)}</b> no ${esc(l.arm)} · no mapa neste armazém <b>${saQ(l.noMapa)}</b>` +
      (l.falta > 0.001 ? ` · <span class="sa-warn">falta mapear <b>${saQ(l.falta)}</b></span>` : ' · <span class="num-pos">tudo mapeado</span>') +
      (total - l.noMapa > 0.001 ? ` · mais <b>${saQ(total - l.noMapa)}</b> do mesmo lote em outro armazém do mapa` : '');
  const dicas = (l.linhaDiv?.dicas || []).slice(0, 4).map(d => `<li class="d-${d.c}">${d.t}</li>`).join('');
  return `<div class="sa-det-in" onclick="event.stopPropagation()">
    <div class="sa-det-top"><div>${resumo}</div>${saSitTag(l)}</div>
    ${vagas}
    ${dicas ? `<ul class="sa-dicas">${dicas}</ul>` : ''}
    ${l.mapaEst !== 'na' && l.mapaEst !== 'ok' ? `<div class="sa-det-pe"><button class="btn btn-ghost btn-sm" onclick="saVerNasDivergencias('${esc(l.lote)}')">Corrigir em Mapa × sistema</button></div>` : ''}
  </div>`;
}
function saVerNasDivergencias(lote) {
  _sa.aba = 'divergencias';
  if ($('s-busca')) { $('s-busca').value = lote; }
  // O lote pode estar só "fora do mapa": mostra todas as situações dele.
  if (typeof setSituacaoSaldo === 'function') _situacao = 'todas';
  renderSaldoErp();
  if (typeof renderSaldo === 'function') renderSaldo();
  $('sa-div')?.scrollIntoView({ block:'start', behavior:'smooth' });
}
function saAbrirProduto(i) {
  const x = _sa.regProd?.[i]; if (!x) return;
  _sa.abertos.has(x.k) ? _sa.abertos.delete(x.k) : _sa.abertos.add(x.k);
  renderSaldoErp();
}

/* ── janelinha de filtro da coluna ── */
let _saPop = null;   // { id, sel:Set, busca }
function saFecharPop() {
  $('sa-pop')?.remove();
  _saPop = null;
}
function saPosicionar(pop, ancora) {
  document.body.appendChild(pop);
  if (innerWidth <= 640) { pop.classList.add('folha'); return; }
  const r = ancora.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = r.left, y = r.bottom + 6;
  if (x + w > innerWidth - 8) x = innerWidth - w - 8;
  if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  pop.style.left = `${Math.max(8, x)}px`; pop.style.top = `${y}px`;
}
function saAbrirFiltro(ev, id) {
  ev.stopPropagation();
  const ja = _saPop?.id === id;
  saFecharPop();
  if (ja) return;
  const c = SA_COL[id], f = _sa.f[id];
  const pop = document.createElement('div');
  pop.id = 'sa-pop'; pop.className = 'sa-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', `Filtro de ${c.rot}`);
  const ordTxt = c.tipo === 'num' ? ['Menor → maior', 'Maior → menor'] : c.tipo === 'data' ? ['Mais antiga primeiro', 'Mais nova primeiro'] : ['A → Z', 'Z → A'];
  let corpo = '';
  if (c.tipo === 'cat') {
    _saPop = { id, busca:'' };
    // Valores possíveis com os OUTROS filtros aplicados (como no Excel).
    const cont = new Map();
    for (const l of saFiltradas(id)) { const v = c.v(l); for (const x of (Array.isArray(v) ? v : [v ?? '—'])) cont.set(String(x), (cont.get(String(x)) || 0) + 1); }
    if (f) for (const v of f.vals) if (!cont.has(v)) cont.set(v, 0);
    _saPop.vals = [...cont.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric:true }));
    _saPop.sel = new Set(f ? f.vals : _saPop.vals.map(v => v[0]));
    corpo = `<input type="search" class="sa-pop-busca" placeholder="Buscar valor" oninput="saPopBusca(this.value)" aria-label="Buscar valor">
      <label class="sa-pop-tudo"><input type="checkbox" id="sa-pop-tudo" onchange="saPopTudo(this.checked)"> <span>Selecionar tudo</span></label>
      <div class="sa-pop-lista" id="sa-pop-lista"></div>`;
  } else if (c.tipo === 'num') {
    _saPop = { id };
    corpo = `<div class="sa-pop-num">
        <label>Mínimo<input type="number" id="sa-pop-min" step="any" value="${f?.min ?? ''}"></label>
        <label>Máximo<input type="number" id="sa-pop-max" step="any" value="${f?.max ?? ''}"></label>
      </div>
      <div class="sa-pop-op">
        <label><input type="radio" name="sa-pop-z" value="" ${!f?.zero ? 'checked' : ''}> Todos</label>
        <label><input type="radio" name="sa-pop-z" value="nz" ${f?.zero === 'nz' ? 'checked' : ''}> Diferente de zero</label>
        <label><input type="radio" name="sa-pop-z" value="z" ${f?.zero === 'z' ? 'checked' : ''}> Zero ou vazio</label>
      </div>`;
  } else {
    _saPop = { id };
    corpo = `${c.faixas ? `<div class="sa-pop-op">${SA_FAIXAS.map(x => `<label><input type="checkbox" class="sa-pop-fx" value="${x.id}" ${f?.faixas?.has(x.id) ? 'checked' : ''}> ${esc(x.rot)}</label>`).join('')}</div>` : ''}
      <div class="sa-pop-num">
        <label>De<input type="date" id="sa-pop-de" value="${f?.de || ''}"></label>
        <label>Até<input type="date" id="sa-pop-ate" value="${f?.ate || ''}"></label>
      </div>`;
  }
  pop.innerHTML = `<div class="sa-pop-cab"><b>${esc(c.rot)}</b><button class="ico-btn" onclick="saFecharPop()" aria-label="Fechar">×</button></div>
    <div class="sa-pop-ord"><button class="btn btn-ghost btn-sm" onclick="saOrdenar('${id}', true)">${ordTxt[0]}</button><button class="btn btn-ghost btn-sm" onclick="saOrdenar('${id}', false)">${ordTxt[1]}</button></div>
    <div class="sa-pop-corpo">${corpo}</div>
    <div class="sa-pop-pe"><button class="btn btn-ghost btn-sm" onclick="saTirarFiltro('${id}')" ${f ? '' : 'disabled'}>Limpar</button>
      <button class="btn btn-primary btn-sm" onclick="saPopAplicar()">Aplicar</button></div>`;
  pop.addEventListener('click', e => e.stopPropagation());
  pop.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.type !== 'checkbox') saPopAplicar(); });
  saPosicionar(pop, ev.currentTarget.closest('th') || ev.currentTarget);
  if (c.tipo === 'cat') { saPopLista(); pop.querySelector('.sa-pop-busca').focus(); }
  else pop.querySelector('input')?.focus();
}
const SA_POP_MAX = 300;
function saPopVisiveis() {
  const q = (_saPop.busca || '').toUpperCase();
  return _saPop.vals.filter(([v]) => !q || v.toUpperCase().includes(q));
}
function saPopLista() {
  const vis = saPopVisiveis();
  $('sa-pop-lista').innerHTML = vis.slice(0, SA_POP_MAX).map(([v, n], i) =>
    `<label><input type="checkbox" data-i="${i}" ${_saPop.sel.has(v) ? 'checked' : ''} onchange="saPopMarca(this)"> <span>${esc(v)}</span><small>${num(n)}</small></label>`).join('')
    + (vis.length > SA_POP_MAX ? `<div class="sa-pop-mais">mostrando ${SA_POP_MAX} de ${num(vis.length)} — busque para achar o resto</div>` : '')
    + (!vis.length ? '<div class="sa-pop-mais">nenhum valor</div>' : '');
  const t = $('sa-pop-tudo');
  const marcados = vis.filter(([v]) => _saPop.sel.has(v)).length;
  t.checked = vis.length > 0 && marcados === vis.length;
  t.indeterminate = marcados > 0 && marcados < vis.length;
}
function saPopBusca(q) {
  _saPop.busca = q;
  // Como no Excel: buscar já deixa marcado só o que aparece.
  if (q) _saPop.sel = new Set(saPopVisiveis().map(([v]) => v));
  saPopLista();
}
function saPopMarca(el) {
  const v = saPopVisiveis()[Number(el.dataset.i)]?.[0];
  if (v === undefined) return;
  el.checked ? _saPop.sel.add(v) : _saPop.sel.delete(v);
  saPopLista();
}
function saPopTudo(on) {
  for (const [v] of saPopVisiveis()) on ? _saPop.sel.add(v) : _saPop.sel.delete(v);
  saPopLista();
}
function saPopAplicar() {
  const { id } = _saPop || {}; if (!id) return;
  const c = SA_COL[id];
  if (c.tipo === 'cat') {
    const todos = _saPop.vals.every(([v]) => _saPop.sel.has(v));
    if (!_saPop.sel.size) { toast('Marque pelo menos um valor.', 'warn'); return; }
    if (todos && !_saPop.busca) delete _sa.f[id]; else _sa.f[id] = { vals:new Set(_saPop.sel) };
  } else if (c.tipo === 'num') {
    const lido = x => { const v = $(x).value; return v === '' ? null : Number(v); };
    const min = lido('sa-pop-min'), max = lido('sa-pop-max');
    const zero = document.querySelector('input[name="sa-pop-z"]:checked')?.value || '';
    if (min === null && max === null && !zero) delete _sa.f[id]; else _sa.f[id] = { min, max, zero };
  } else {
    const faixas = new Set([...document.querySelectorAll('.sa-pop-fx:checked')].map(x => x.value));
    const de = $('sa-pop-de').value || null, ate = $('sa-pop-ate').value || null;
    if (!faixas.size && !de && !ate) delete _sa.f[id]; else _sa.f[id] = { faixas, de, ate };
  }
  saFecharPop();
  renderSaldoErp();
}
/* Mostrar / esconder colunas. */
function saAbrirColunas(ev) {
  ev.stopPropagation();
  const ja = _saPop?.id === '__cols';
  saFecharPop();
  if (ja) return;
  _saPop = { id:'__cols' };
  const pop = document.createElement('div');
  pop.id = 'sa-pop'; pop.className = 'sa-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Colunas');
  pop.innerHTML = `<div class="sa-pop-cab"><b>Colunas</b><button class="ico-btn" onclick="saFecharPop()" aria-label="Fechar">×</button></div>
    <div class="sa-pop-corpo"><div class="sa-pop-lista">${SA_COLS.map(c => `<label><input type="checkbox" ${_saVisiveis.has(c.id) ? 'checked' : ''} onchange="saColuna('${c.id}', this.checked)"> <span>${esc(c.rot)}</span></label>`).join('')}</div></div>
    <div class="sa-pop-pe"><button class="btn btn-ghost btn-sm" onclick="saColunasPadrao()">Voltar ao padrão</button></div>`;
  pop.addEventListener('click', e => e.stopPropagation());
  saPosicionar(pop, ev.currentTarget);
}
function saColuna(id, on) {
  on ? _saVisiveis.add(id) : _saVisiveis.delete(id);
  if (!_saVisiveis.size) _saVisiveis.add('desc');
  saGravarColunas();
  const pop = $('sa-pop'); if (pop) pop.remove();
  renderSaldoErp();
  // reabre a lista de colunas no mesmo lugar para marcar várias seguidas
  const bt = document.querySelector('#sa-ctrl .sa-cols-wrap button');
  if (bt) { _saPop = null; bt.click(); }
}
function saColunasPadrao() {
  _saVisiveis = new Set(SA_COLS.filter(c => !c.oculta).map(c => c.id));
  saGravarColunas();
  saFecharPop();
  renderSaldoErp();
}
document.addEventListener('click', () => { if (_saPop) saFecharPop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && _saPop) saFecharPop(); });

/* ── menu ⋯ e importação manual (reserva para quando o robô parar) ── */
function saMenu(ev) {
  ev.stopPropagation();
  const dd = $('sa-dd-mais'), bt = $('sa-bt-mais');
  const abre = !dd.classList.contains('open');
  dd.classList.toggle('open', abre);
  bt.setAttribute('aria-expanded', String(abre));
}
document.addEventListener('click', e => {
  if (!e.target.closest('#sa-menu')) { $('sa-dd-mais')?.classList.remove('open'); $('sa-bt-mais')?.setAttribute('aria-expanded', 'false'); }
});
function saAbrirImport() {
  $('sa-dd-mais').classList.remove('open');
  if (typeof renderInfoRef === 'function') renderInfoRef();
  abrirModal('modal-sa-import');
}

/* ── Totais por filial / armazém / tipo, com empenhado × livre ── */
function saTotais(lista) {
  $('sa-ctrl').innerHTML = saCtrlSeg('grupo', [['filial', 'Filial'], ['armazem', 'Armazém'], ['tipo', 'Tipo']], 'Agrupar por');
  const chaveG = { filial:l => filialCurta(l.filial), armazem:l => l.arm, tipo:l => l.tipo }[_sa.grupo];
  const g = new Map();
  for (const l of lista) { const k = chaveG(l); (g.get(k) || g.set(k, []).get(k)).push(l); }
  const ordem = _sa.grupo === 'armazem'
    ? (a, b) => { const ka = Object.keys(ARMAZENS), ia = ka.indexOf(a), ib = ka.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); }
    : (a, b) => a.localeCompare(b);
  const rotulo = k => {
    if (_sa.grupo === 'filial') {
      const ex = lista.find(l => filialCurta(l.filial) === k);
      return `${badgeFilial(ex?.filial)}<div class="sub">${esc(ex?.filial || '')}</div>`;
    }
    if (_sa.grupo === 'armazem') return `<b class="mono-b">${esc(k)}</b><div class="sub">${esc(nomeArmazem(k) || 'fora da lista de armazéns')}</div>`;
    return `<b class="mono-b">${esc(k)}</b><div class="sub">${esc(SA_TIPOS[k] || '')}</div>`;
  };
  const filtro = { filial:'filial', armazem:'arm', tipo:'tipo' }[_sa.grupo];

  const linhas = [];
  for (const k of [...g.keys()].sort(ordem)) {
    const pu = saPorUn(g.get(k));
    const uns = Object.keys(pu).sort(saOrdUn);
    uns.forEach((u, i) => {
      const x = pu[u], p = x.saldo ? Math.max(0, Math.min(100, x.emp / x.saldo * 100)) : 0;
      const clique = filtro && i === 0 ? ` class="sa-clica" title="Filtrar por ${esc(k)}" onclick="saFiltrarValor('${filtro}', '${esc(k)}')"` : '';
      linhas.push(`<tr${i === 0 ? ' class="sa-g1"' : ''}>
        ${i === 0 ? `<td rowspan="${uns.length}"${clique}>${rotulo(k)}</td>` : ''}
        <td><span class="tag t-mute">${esc(u)}</span></td>
        <td class="num">${num(x.lotes)}</td>
        <td class="num">${x.temPl ? num1(x.pl) : '—'}</td>
        <td class="num"><b>${saQ(x.saldo)}</b></td>
        <td class="num">${saQ(x.emp)}</td>
        <td class="num">${saQ(x.saldo - x.emp)}</td>
        <td><div class="k-pbar"><div class="bar"><i style="width:${p.toFixed(1)}%"></i></div><span>${num1(p)}%</span></div></td>
      </tr>`);
    });
  }
  const tot = saPorUn(lista);
  const pe = Object.keys(tot).sort(saOrdUn).map((u, i, a) => {
    const x = tot[u], p = x.saldo ? x.emp / x.saldo * 100 : 0;
    return `<tr>${i === 0 ? `<td rowspan="${a.length}">Total</td>` : ''}<td><span class="tag t-mute">${esc(u)}</span></td>
      <td class="num">${num(x.lotes)}</td><td class="num">${x.temPl ? num1(x.pl) : '—'}</td>
      <td class="num">${saQ(x.saldo)}</td><td class="num">${saQ(x.emp)}</td><td class="num">${saQ(x.saldo - x.emp)}</td>
      <td class="num">${num1(p)}%</td></tr>`;
  }).join('');

  $('sa-corpo').innerHTML = `
    <div class="tbl-wrap"><table class="sa-tot">
      <thead><tr><th>${{ filial:'Filial', armazem:'Armazém', tipo:'Tipo' }[_sa.grupo]}</th><th>Unid.</th>
        <th class="num">Lotes</th><th class="num">Paletes</th><th class="num">Saldo</th>
        <th class="num">Empenhado</th><th class="num">Livre</th><th>% empenhado</th></tr></thead>
      <tbody>${linhas.join('') || vazio('Nada com esses filtros', '', 8)}</tbody>
      ${linhas.length ? `<tfoot>${pe}</tfoot>` : ''}
    </table></div>`;
}

/* ── Validade: vencidos e vencendo, com quantidade e onde estão ── */
function saValidade(lista) {
  $('sa-ctrl').innerHTML = '';
  const comSaldo = lista.filter(l => l.saldo > 0);
  const cartoes = SA_FAIXAS.map(fx => {
    const ls = comSaldo.filter(l => fx.t(l.dias));
    return `<button class="kpi sa-faixa ${fx.cls}${_sa.faixa === fx.id ? ' sel' : ''}" aria-pressed="${_sa.faixa === fx.id}" onclick="saSet('faixa','${fx.id}')">
      <div class="kpi-label">${esc(fx.rot)}</div>
      <div class="kpi-value">${num(ls.length)}<small> lote(s)</small></div>
      <div class="kpi-foot">${ls.length ? saTxtUn(ls) : '—'}</div></button>`;
  }).join('');

  const fx = SA_FAIXAS.find(x => x.id === _sa.faixa) || SA_FAIXAS[0];
  const ls = comSaldo.filter(l => fx.t(l.dias))
    .sort((a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9) || a.desc.localeCompare(b.desc));
  _sa.export = () => ls.map(l => ({ Produto:l.desc, Codigo:l.cod, Tipo:l.tipo, Lote:l.lote, Filial:l.filial, Armazem:l.arm,
    Fabricacao:saData(l.fab), Validade:saData(l.val), Dias:l.dias ?? '', Saldo:l.saldo, Unidade:l.un, Empenho:l.emp, Paletes:l.pl ?? '',
    Vagas:(l.vagas || []).join(' ') }));
  const p = fatiar('sa-val', ls, saAssin() + fx.id);

  $('sa-corpo').innerHTML = `
    <div class="sa-faixas">${cartoes}</div>
    <div class="sa-resumo">${esc(fx.rot)}: <b>${num(ls.length)}</b> lote(s) · ${saTxtUn(ls)}</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Produto</th><th>Lote</th><th>Filial</th><th>Armazém</th><th>Vagas no mapa</th>
        <th>Validade</th><th class="num">Prazo</th><th class="num">Saldo</th><th class="num">Empenhado</th><th class="num">Paletes</th></tr></thead>
      <tbody>${p.itens.map(l => `<tr>
        <td class="nome">${saProd(l)}</td><td class="mono">${esc(l.lote || '—')}</td><td>${badgeFilial(l.filial, l.cod)}</td>
        <td>${saArm(l.arm)}</td><td>${saVagas(l)}</td>
        <td class="mono">${saData(l.val)}</td><td class="num">${saDiasTxt(l.dias)}</td>
        <td class="num">${saQ(l.saldo)} ${esc(l.un)}</td><td class="num">${l.emp ? saQ(l.emp) : '—'}</td><td class="num">${saPl(l.pl)}</td>
      </tr>`).join('') || vazio('Nenhum lote nesta faixa', 'Escolha outra faixa ali em cima.', 10)}</tbody>
    </table></div>${barraPag('sa-val', p, 'lote(s)')}`;
}

/* ── Mesmo lote em mais de um armazém ── */
function saDivTab() {
  $('sa-ctrl').innerHTML = `<span class="section-note">Mesma filial, código e lote com saldo em mais de um armazém.</span>`;
  const gs = saDivididos();
  _sa.export = () => gs.flatMap(g => g.ls.map(l => ({ Produto:l.desc, Codigo:l.cod, Lote:l.lote, Filial:l.filial,
    Armazem:l.arm, Saldo:l.saldo, Unidade:l.un, TotalDoLote:g.total, Armazens:g.ls.length, Validade:saData(l.val) })));
  const p = fatiar('sa-div', gs, saAssin());
  $('sa-corpo').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Produto</th><th>Lote</th><th>Filial</th><th>Onde está</th><th class="num">Total</th><th>Validade</th><th>Vagas no mapa</th></tr></thead>
      <tbody>${p.itens.map(g => `<tr>
        <td class="nome">${saProd(g.l)}</td><td class="mono">${esc(g.l.lote || '—')}</td><td>${badgeFilial(g.l.filial, g.l.cod)}</td>
        <td><div class="sa-arms">${g.ls.map(l => `<span class="sa-arm-q" title="${esc(nomeArmazem(l.arm))}"><b>${esc(l.arm)}</b>${saQ(l.saldo)} ${esc(l.un)}</span>`).join('')}</div></td>
        <td class="num"><b>${saQ(g.total)}</b> ${esc(g.l.un)}</td>
        <td class="mono">${saData(g.l.val)}<div class="sub">${g.l.dias !== null ? saDiasTxt(g.l.dias) : ''}</div></td>
        <td>${saVagas(g.l)}</td>
      </tr>`).join('') || vazio('Nenhum lote dividido', 'Cada lote está num armazém só.', 7)}</tbody>
    </table></div>${barraPag('sa-div', p, 'lote(s)')}`;
}

/* ── Armazém que não combina com a validade ── */
function saArmTab(lista) {
  const todos = saForaDaRegra(lista.filter(l => l.saldo > 0));
  $('sa-ctrl').innerHTML = `<div class="seg">${[['', 'Todos', todos.length], ...SA_REGRAS.map(r => [r.id, r.rot, todos.filter(x => x.r.id === r.id).length])]
    .map(([id, rot, n]) => `<button class="${_sa.regra === id ? 'active' : ''}" onclick="saSet('regra','${id}')">${esc(rot)} <span class="sa-n">${num(n)}</span></button>`).join('')}</div>`;
  const ls = todos.filter(x => !_sa.regra || x.r.id === _sa.regra)
    .sort((a, b) => SA_REGRAS.indexOf(a.r) - SA_REGRAS.indexOf(b.r) || (a.l.dias ?? 0) - (b.l.dias ?? 0));
  _sa.export = () => ls.map(({ l, r }) => ({ Situacao:r.rot, Produto:l.desc, Codigo:l.cod, Lote:l.lote, Filial:l.filial,
    Armazem:l.arm, Validade:saData(l.val), Dias:l.dias ?? '', Saldo:l.saldo, Unidade:l.un, Vagas:(l.vagas || []).join(' ') }));
  const p = fatiar('sa-reg', ls, saAssin() + _sa.regra);
  $('sa-corpo').innerHTML = `
    <div class="sa-resumo">Regra: lote vencido fica no <b>D7</b>, e o D7 é só para vencido. Para mudar a regra, fale com quem cuida do sistema (SA_REGRAS no saldo-erp.js).</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Situação</th><th>Produto</th><th>Lote</th><th>Filial</th><th>Armazém</th><th>Validade</th><th class="num">Prazo</th><th class="num">Saldo</th><th>Vagas no mapa</th></tr></thead>
      <tbody>${p.itens.map(({ l, r }) => `<tr>
        <td><span class="tag ${r.cls}">${esc(r.rot)}</span></td>
        <td class="nome">${saProd(l)}</td><td class="mono">${esc(l.lote || '—')}</td><td>${badgeFilial(l.filial, l.cod)}</td>
        <td>${saArm(l.arm)}</td><td class="mono">${saData(l.val)}</td><td class="num">${saDiasTxt(l.dias)}</td>
        <td class="num">${saQ(l.saldo)} ${esc(l.un)}</td><td>${saVagas(l)}</td>
      </tr>`).join('') || vazio('Tudo no armazém certo', 'Nenhum vencido fora do D7 e nenhum lote válido no D7.', 9)}</tbody>
    </table></div>${barraPag('sa-reg', p, 'lote(s)')}`;
}

/* ── Lotes parados (saldo sem mudar há N dias) ── */
function saParadosTab(lista) {
  $('sa-ctrl').innerHTML = saCtrlSeg('parado', [[30, '30 dias'], [60, '60'], [90, '90'], [180, '180'], [365, '1 ano']], 'Sem mexer há') +
    `<label class="sa-check"><input type="checkbox" ${_sa.semD7 ? 'checked' : ''} onchange="saSet('semD7', this.checked)"> Esconder o D7</label>`;
  if (!_sa.lotes) {
    $('sa-corpo').innerHTML = `<div class="panel-body"><div class="aviso a-warn" style="margin:0"><span class="aviso-ico">!</span><div><b>Precisa do histórico</b>
      Rode o <b>sql/migracao-saldo-historico.sql</b> no Supabase. A partir daí, cada foto do ERP marca quando o saldo de cada lote mudou.</div></div></div>`;
    return;
  }
  const ls = saParados(lista).filter(x => x.dias >= _sa.parado && !(_sa.semD7 && x.l.arm === 'D7'))
    .sort((a, b) => b.dias - a.dias || a.l.desc.localeCompare(b.l.desc));
  _sa.export = () => ls.map(({ l, dias, desde, desdeInicio }) => ({ Produto:l.desc, Codigo:l.cod, Lote:l.lote, Filial:l.filial, Armazem:l.arm,
    Saldo:l.saldo, Unidade:l.un, Validade:saData(l.val), SemMexerDesde:fmtDia(desde), Dias:(desdeInicio ? '>=' : '') + dias }));
  const p = fatiar('sa-par', ls, saAssin() + _sa.parado + _sa.semD7);
  const ini = _sa.inicioHist;
  const diasHist = ini ? saDias(ini) * -1 : 0;
  $('sa-corpo').innerHTML = `
    ${ini ? `<div class="sa-resumo">O histórico começou em <b>${saData(ini)}</b>${diasHist < _sa.parado
      ? ` (${num(diasHist)} dia(s) atrás) — ainda não dá para ver lote parado há ${num(_sa.parado)} dias. A lista enche conforme o robô manda as fotos.`
      : '. Lote marcado com ≥ não mudou desde o começo do histórico — pode estar parado há mais tempo.'}</div>` : ''}
    <div class="sa-resumo">${num(ls.length)} lote(s) · ${saTxtUn(ls.map(x => x.l))}</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Produto</th><th>Lote</th><th>Filial</th><th>Armazém</th><th class="num">Saldo</th><th>Validade</th><th>Sem mexer desde</th><th class="num">Dias</th><th>Vagas no mapa</th></tr></thead>
      <tbody>${p.itens.map(({ l, dias, desde, desdeInicio }) => `<tr>
        <td class="nome">${saProd(l)}</td><td class="mono">${esc(l.lote || '—')}</td><td>${badgeFilial(l.filial, l.cod)}</td>
        <td>${saArm(l.arm)}</td><td class="num">${saQ(l.saldo)} ${esc(l.un)}</td>
        <td class="mono">${saData(l.val)}${l.dias !== null && l.dias < 0 ? '<div class="sub num-neg">vencido</div>' : ''}</td>
        <td class="mono">${fmtDia(desde)}</td><td class="num"><b>${desdeInicio ? '≥ ' : ''}${num(dias)}</b></td><td>${saVagas(l)}</td>
      </tr>`).join('') || vazio(`Nenhum lote parado há ${num(_sa.parado)} dias ou mais`, '', 9)}</tbody>
    </table></div>${barraPag('sa-par', p, 'lote(s)')}`;
}

/* ── Evolução diária (estoque_ref_dia) ── */
function saEvolucao() {
  $('sa-ctrl').innerHTML = saCtrlSeg('periodo', [[30, '30 dias'], [90, '90 dias'], [365, '1 ano']], 'Período');
  if (!_sa.dia) {
    $('sa-corpo').innerHTML = `<div class="panel-body"><div class="aviso a-warn" style="margin:0"><span class="aviso-ico">!</span><div><b>Precisa do histórico</b>
      Rode o <b>sql/migracao-saldo-historico.sql</b> no Supabase. A partir daí, cada dia com foto do ERP vira um ponto aqui.</div></div></div>`;
    return;
  }
  // Os filtros de Filial, Armazém, Tipo e UM valem aqui; os outros não
  // (o histórico é guardado por armazém, unidade e tipo, não por lote).
  const fv = id => _sa.f[id]?.vals || null;
  const fArm = fv('arm'), fTipo = fv('tipo'), fUn = fv('un'), fFil = fv('filial');
  const corte = new Date(Date.now() - _sa.periodo * 864e5).toISOString().slice(0, 10);
  // dia → unidade → {saldo, emp, venc}
  const porDia = new Map();
  for (const r of _sa.dia) {
    const d = String(r.dia).slice(0, 10);
    if (d < corte || !daFilial(r.filial) || (fArm && !fArm.has(r.armazem)) || (fTipo && !fTipo.has(r.tipo || '—'))
        || (fFil && !fFil.has(filialCurta(r.filial)))) continue;
    const u = saUn(r.unidade);
    if (fUn && !fUn.has(u)) continue;
    const o = porDia.get(d) || porDia.set(d, {}).get(d);
    const x = o[u] ||= { saldo:0, emp:0, venc:0 };
    x.saldo += Number(r.saldo) || 0; x.emp += Number(r.empenho) || 0; x.venc += Number(r.vencido) || 0;
  }
  const dias = [...porDia.keys()].sort();
  const uns = [...new Set(dias.flatMap(d => Object.keys(porDia.get(d))))].sort(saOrdUn);
  const outros = Object.keys(_sa.f).filter(id => !['arm', 'tipo', 'un', 'filial'].includes(id));
  const busca = $('sa-busca').value.trim() || outros.length
    ? `<div class="sa-resumo">Aqui só valem os filtros de filial, armazém, tipo e UM: o histórico é guardado por armazém, unidade e tipo, não por lote.${outros.length ? ` Ignorados: ${outros.map(id => esc(SA_COL[id].rot)).join(', ')}${$('sa-busca').value.trim() ? ' e a busca' : ''}.` : ' A busca foi ignorada.'}</div>` : '';

  if (dias.length < 2) {
    $('sa-corpo').innerHTML = `${busca}<div class="panel-body"><div class="aviso a-info" style="margin:0"><span class="aviso-ico">◔</span><div>
      <b>${dias.length ? `O histórico começou em ${saData(dias[0])}` : 'Ainda sem histórico neste filtro'}</b>
      O gráfico aparece a partir do segundo dia com foto do ERP. O robô manda a foto sozinho; com a importação manual, entra um ponto por dia importado.</div></div></div>`;
    _sa.export = () => dias.map(d => saLinhaEvo(d, porDia, uns));
    return;
  }

  _sa.graf = {};
  const graficos = uns.map(u => {
    const pts = dias.map(d => ({ d, v:porDia.get(d)[u]?.saldo || 0, e:porDia.get(d)[u]?.emp || 0, x:porDia.get(d)[u]?.venc || 0 }));
    _sa.graf[u] = pts;
    const ult = pts[pts.length - 1].v, pri = pts[0].v, dif = ult - pri;
    return `<div class="sa-graf">
      <div class="sa-graf-top">
        <div><div class="sa-graf-un">Saldo em ${esc(u)}</div><div class="sa-graf-v">${saQ(ult)}</div></div>
        <div class="sa-graf-dif ${dif > 0 ? 'num-pos' : dif < 0 ? 'num-neg' : 'num-zero'}">${dif > 0 ? '+' : ''}${saQ(dif)} ${esc(u)}<div class="sub">desde ${saData(pts[0].d)}</div></div>
      </div>
      <div class="sa-plot" data-un="${esc(u)}"><div class="sa-svg"></div><div class="sa-tip" hidden></div></div>
    </div>`;
  }).join('');

  const desc = [...dias].reverse();
  _sa.export = () => desc.map(d => saLinhaEvo(d, porDia, uns));
  const p = fatiar('sa-evo', desc, saAssin() + _sa.periodo);
  const linhas = p.itens.map(d => {
    const i = dias.indexOf(d), ant = i > 0 ? porDia.get(dias[i - 1]) : null;
    return `<tr><td class="mono">${saData(d)}</td>${uns.map(u => {
      const v = porDia.get(d)[u]?.saldo || 0, dv = ant ? v - (ant[u]?.saldo || 0) : null;
      return `<td class="num">${saQ(v)}</td><td class="num ${dv > 0 ? 'num-pos' : dv < 0 ? 'num-neg' : 'num-zero'}">${dv === null ? '—' : (dv > 0 ? '+' : '') + saQ(dv)}</td>`;
    }).join('')}${uns.map(u => `<td class="num">${saQ(porDia.get(d)[u]?.venc || 0)}</td>`).join('')}</tr>`;
  }).join('');

  $('sa-corpo').innerHTML = `${busca}
    <div class="sa-graficos">${graficos}</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Dia</th>${uns.map(u => `<th class="num">Saldo ${esc(u)}</th><th class="num">Variação</th>`).join('')}${uns.map(u => `<th class="num">Vencido ${esc(u)}</th>`).join('')}</tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>${barraPag('sa-evo', p, 'dia(s)')}`;
  saDesenharGraficos();
}
function saLinhaEvo(d, porDia, uns) {
  const o = { Dia:saData(d) };
  for (const u of uns) { o[`Saldo ${u}`] = porDia.get(d)[u]?.saldo || 0; o[`Empenhado ${u}`] = porDia.get(d)[u]?.emp || 0; o[`Vencido ${u}`] = porDia.get(d)[u]?.venc || 0; }
  return o;
}

/* Linha simples: um eixo, grade discreta, valores nos rótulos.
   Desenhada na largura real do cartão (texto não estica no celular). */
const SA_H = 190, SA_M = { l:58, r:14, t:10, b:24 };
function saEscala(pts) {
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (lo === hi) { lo = lo ? lo * .9 : 0; hi = hi ? hi * 1.1 : 1; }
  const bruto = (hi - lo) / 3, p10 = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * p10).find(s => s >= bruto);
  lo = Math.floor(lo / passo) * passo; hi = Math.ceil(hi / passo) * passo;
  const ticks = []; for (let v = lo; v <= hi + passo / 2; v += passo) ticks.push(v);
  return { lo, hi, ticks };
}
function saGeo(pts, W) {
  const { lo, hi, ticks } = saEscala(pts);
  const iw = W - SA_M.l - SA_M.r, ih = SA_H - SA_M.t - SA_M.b;
  return { lo, hi, ticks, iw, ih,
    x:i => SA_M.l + (pts.length === 1 ? iw / 2 : i / (pts.length - 1) * iw),
    y:v => SA_M.t + ih - (v - lo) / (hi - lo || 1) * ih };
}
function saSVG(pts, W) {
  const g = saGeo(pts, W);
  const curto = v => Math.abs(v) >= 1e6 ? num1(v / 1e6) + ' mi' : Math.abs(v) >= 1e4 ? num(Math.round(v / 1e3)) + ' mil' : num(v);
  const grade = g.ticks.map(t => `<line x1="${SA_M.l}" x2="${W - SA_M.r}" y1="${g.y(t)}" y2="${g.y(t)}" class="sa-grade"/>` +
    `<text x="${SA_M.l - 8}" y="${g.y(t) + 4}" text-anchor="end" class="sa-eixo">${curto(t)}</text>`).join('');
  const n = pts.length - 1;
  const idx = [...new Set(W < 360 ? [0, n] : [0, Math.floor(n / 2), n])];
  const rx = idx.map(i => `<text x="${g.x(i)}" y="${SA_H - 6}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}" class="sa-eixo">${saData(pts[i].d).slice(0, 5)}</text>`).join('');
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${g.x(i).toFixed(1)},${g.y(p.v).toFixed(1)}`).join('');
  return `<svg width="${W}" height="${SA_H}" viewBox="0 0 ${W} ${SA_H}" role="img" aria-label="Evolução do saldo de ${saData(pts[0].d)} a ${saData(pts[n].d)}">
    ${grade}${rx}
    <path d="${d}" class="sa-linha"/>
    <circle cx="${g.x(n)}" cy="${g.y(pts[n].v)}" r="4" class="sa-ponto"/>
    <line class="sa-cruz" x1="0" x2="0" y1="${SA_M.t}" y2="${SA_M.t + g.ih}" visibility="hidden"/>
    <circle class="sa-ponto sa-foco" r="4.5" cx="0" cy="0" visibility="hidden"/>
  </svg>`;
}
function saDesenharGraficos() {
  document.querySelectorAll('#sa-corpo .sa-plot').forEach(el => {
    const pts = _sa.graf[el.dataset.un];
    const W = Math.max(240, el.clientWidth);
    if (!pts?.length) return;
    el.querySelector('.sa-svg').innerHTML = saSVG(pts, W);
    el._w = W;
    if (!el._hover) { saHover(el); el._hover = true; }
  });
}
addEventListener('resize', debounce(() => {
  if ($('page-saldo')?.classList.contains('active') && _sa.aba === 'evolucao') saDesenharGraficos();
}, 150));

function saHover(el) {
  const u = el.dataset.un, tip = el.querySelector('.sa-tip');
  const mover = ev => {
    const pts = _sa.graf[u], svg = el.querySelector('svg');
    if (!pts?.length || !svg) return;
    const g = saGeo(pts, el._w);
    const r = svg.getBoundingClientRect();
    const sx = ev.clientX - r.left;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((sx - SA_M.l) / g.iw * (pts.length - 1))));
    const p = pts[i], cx = g.x(i), cy = g.y(p.v);
    const cruz = svg.querySelector('.sa-cruz'), foco = svg.querySelector('.sa-foco');
    cruz.setAttribute('x1', cx); cruz.setAttribute('x2', cx); cruz.setAttribute('visibility', 'visible');
    foco.setAttribute('cx', cx); foco.setAttribute('cy', cy); foco.setAttribute('visibility', 'visible');
    const ant = i > 0 ? pts[i - 1].v : null;
    tip.innerHTML = `<b>${saData(p.d)}</b><div>Saldo <span>${saQ(p.v)} ${esc(u)}</span></div>` +
      (ant !== null ? `<div>Variação no dia <span>${p.v - ant > 0 ? '+' : ''}${saQ(p.v - ant)}</span></div>` : '') +
      `<div>Empenhado <span>${saQ(p.e)}</span></div>${p.x ? `<div>Vencido <span>${saQ(p.x)}</span></div>` : ''}`;
    tip.hidden = false;
    const larg = tip.offsetWidth;
    tip.style.left = `${cx + 14 + larg > r.width ? Math.max(0, cx - larg - 14) : cx + 14}px`;
  };
  const sair = () => {
    tip.hidden = true;
    el.querySelectorAll('.sa-cruz, .sa-foco').forEach(n => n.setAttribute('visibility', 'hidden'));
  };
  el.addEventListener('pointermove', mover);
  el.addEventListener('pointerdown', mover);
  el.addEventListener('pointerleave', sair);
}

/* ═══════════ EXPORTAR ═══════════
   O que está na tela, com os filtros. Em .xlsx (abre direto no Excel). */
function exportarSaldoErp() {
  if (_sa.aba === 'divergencias') { baixarCSV(); return; }
  if (_sa.aba === 'totais') {
    const ls = saFiltradas(), chaveG = { filial:l => filialCurta(l.filial), armazem:l => l.arm, tipo:l => l.tipo }[_sa.grupo];
    const g = {};
    for (const l of ls) { const k = `${chaveG(l)}|${l.un}`; const x = g[k] ||= { Grupo:chaveG(l), Unidade:l.un, Lotes:0, Paletes:0, Saldo:0, Empenhado:0, Livre:0 };
      x.Lotes++; x.Paletes += l.pl || 0; x.Saldo += l.saldo; x.Empenhado += l.emp; x.Livre += l.saldo - l.emp; }
    _sa.export = () => Object.values(g);
  }
  const dados = _sa.export ? _sa.export() : [];
  if (!dados.length) { toast('Nada para exportar.', 'warn'); return; }
  const nome = `saldo-${_sa.aba}${_sa.aba === 'planilha' && _sa.visao === 'produtos' ? '-produtos' : ''}-${saHoje()}`;
  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.json_to_sheet(dados);
    const cab = Object.keys(dados[0]);
    ws['!cols'] = cab.map(c => ({ wch:Math.min(48, Math.max(c.length + 2, ...dados.slice(0, 200).map(d => String(d[c] ?? '').length + 1))) }));
    ws['!autofilter'] = { ref:XLSX.utils.encode_range({ s:{ r:0, c:0 }, e:{ r:dados.length, c:cab.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Saldo');
    XLSX.writeFile(wb, `${nome}.xlsx`);
  } else {
    const cab = Object.keys(dados[0]);
    const fmt = v => typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4).replace('.', ',') : String(v ?? '');
    const txt = [cab, ...dados.map(d => cab.map(c => fmt(d[c])))]
      .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + txt], { type:'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${nome}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  toast(`${num(dados.length)} linha(s) exportada(s).`);
}
