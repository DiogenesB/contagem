/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · SALDO-ERP.JS
   Tela "Saldo" do painel: o saldo do ERP (estoque_ref, a planilha
   SB8_SALDOS_LOTES que o robô ou a importação manual mandam) visto
   por filial, armazém, tipo e validade, mais o histórico
   (estoque_ref_dia e estoque_ref_lote — sql/migracao-saldo-historico.sql).
   Só lê. Quem grava a foto é o Saldo mapeado / o robô.
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
  ['totais',    'Totais'],
  ['validade',  'Validade'],
  ['divididos', 'Lote em 2+ armazéns'],
  ['armazem',   'Armazém × validade'],
  ['evolucao',  'Evolução'],
  ['parados',   'Parados'],
];

const _sa = {
  ref:[], dia:null, lotes:null, erroDia:null, erroLotes:null, vagas:{},
  ok:false, foto:null,
  aba:'totais', grupo:'armazem', faixa:'venc', regra:'', periodo:90, parado:30, semD7:true,
  inicioHist:null, graf:{},
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
/* Dias entre hoje e a data (AAAA-MM-DD), sem fuso: 0 = vence hoje. */
function saDias(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const [hy, hm, hd] = saHoje().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hy, hm - 1, hd)) / 864e5);
}
const saData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
const saQ = n => num(Math.round((Number(n) || 0) * 100) / 100);
const saPl = n => n == null ? '—' : num1(n);
function saOrdUn(a, b) {
  const ia = SA_UNS.indexOf(a), ib = SA_UNS.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b));
}
/* { L:{saldo,emp,lotes,pl}, KG:… } da lista. */
function saPorUn(lista) {
  const o = {};
  for (const l of lista) {
    const u = o[l.un] ||= { saldo:0, emp:0, lotes:0, pl:0, temPl:false };
    u.saldo += l.saldo; u.emp += l.emp; u.lotes++;
    if (l.pl != null) { u.pl += l.pl; u.temPl = true; }
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
  return `<span class="tag t-mute t-mono" title="${esc(nome || 'armazém fora da lista')}">${esc(a)}</span>`;
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
/* Vagas do mapa (drive-in e separação) onde o lote está. */
function saVagas(l) {
  const v = _sa.vagas[`${l.cod}|${l.lote}`];
  if (!v?.length) return '<span class="num-zero">—</span>';
  const mostra = v.slice(0, 3).map(p => `<span class="tag t-info t-mono">${esc(p)}</span>`).join('');
  return `<div class="chips">${mostra}${v.length > 3 ? `<span class="tag t-mute" title="${esc(v.slice(3).join(', '))}">+${v.length - 3}</span>` : ''}</div>`;
}

/* ═══════════ CARGA ═══════════ */
async function carregarSaldoErp(forcar = false) {
  if (_sa.ok && !forcar && cacheValido('saldo-erp', 120)) { renderSaldoErp(); return; }
  if (!_sa.ok) $('sa-corpo').innerHTML = '<div class="skeleton">carregando o saldo…</div>';
  const tenta = p => p.then(d => ({ d }), e => ({ e }));
  const desde = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const [ref, dia, lotes] = await Promise.all([
    tenta(buscarTudo(() => sb.from('estoque_ref').select('*').order('id'))),
    tenta(buscarTudo(() => sb.from('estoque_ref_dia')
      .select('dia, filial, armazem, unidade, tipo, saldo, empenho, vencido, paletes, lotes')
      .gte('dia', desde).order('dia').order('filial').order('armazem').order('unidade').order('tipo'))),
    tenta(buscarTudo(() => sb.from('estoque_ref_lote')
      .select('filial, codigo, lote, armazem, primeiro_visto, ultima_mudanca')
      .order('filial').order('codigo').order('lote').order('armazem'))),
  ]);
  if (ref.e) { erro('Falha ao carregar o saldo', ref.e); $('sa-corpo').innerHTML = ''; return; }

  // Uma linha por filial + código + lote + armazém (a planilha pode repetir).
  const m = new Map();
  let de = null, ate = null, quem = null;
  for (const r of ref.d) {
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
      l = { k, filial:fil, cod, lote, arm,
            desc:String(r.descricao || '').trim() || produtoPorCodigo(cod)?.nome || cod,
            un:saUn(r.unidade || produtoPorCodigo(cod)?.unidade), tipo:String(r.tipo || '').trim().toUpperCase() || '—',
            val, fab:r.dt_fabricacao ? String(r.dt_fabricacao).slice(0, 10) : null,
            dias:val ? saDias(val) : null, saldo:0, emp:0, pl:null };
      l._busca = `${cod} ${l.desc} ${lote}`.toUpperCase();
      m.set(k, l);
    }
    l.saldo += Number(r.saldo) || 0;
    l.emp   += Number(r.empenho) || 0;
    if (r.paletes != null && r.paletes !== '') l.pl = (l.pl || 0) + Number(r.paletes);
  }
  _sa.ref = [...m.values()].filter(l => l.saldo !== 0 || l.emp !== 0);
  _sa.foto = de ? { de, ate, quem } : null;

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

  // Onde está no mapa: mesma ocupação que o Saldo mapeado usa.
  try {
    if (typeof carregarOcupacaoSaldo === 'function') await carregarOcupacaoSaldo();
    const vg = {};
    for (const [pos, itens] of Object.entries(typeof _sOcup === 'object' && _sOcup ? _sOcup : {}))
      for (const it of itens) {
        const k = `${normalizarCodigo(it.codigo)}|${String(it.lote || '').trim().toUpperCase()}`;
        const a = vg[k] ||= [];
        if (!a.includes(pos)) a.push(pos);
      }
    for (const a of Object.values(vg)) a.sort();
    _sa.vagas = vg;
  } catch { _sa.vagas = {}; }

  _sa.ok = true;
  cacheGravar('saldo-erp', true);
  preencherSelect('sa-arm', _sa.ref.map(l => l.arm), 'Todos');
  preencherSelect('sa-tipo', _sa.ref.map(l => l.tipo), 'Todos');
  preencherSelect('sa-un', _sa.ref.map(l => l.un), 'Todas');
  renderSaldoErp();
}

/* Filtros da página. `sem` tira um deles (lote dividido precisa ver
   os outros armazéns mesmo com um armazém escolhido). */
function saFiltradas(sem = '') {
  const arm = $('sa-arm').value, tipo = $('sa-tipo').value, un = $('sa-un').value;
  const ts = termos($('sa-busca').value);
  return _sa.ref.filter(l =>
    daFilial(l.filial) &&
    (sem === 'arm' || !arm || l.arm === arm) &&
    (!tipo || l.tipo === tipo) &&
    (!un || l.un === un) &&
    casa(l, ts));
}
function saAssin() {
  return [$('filtro-filial').value, $('sa-arm').value, $('sa-tipo').value, $('sa-un').value, $('sa-busca').value].join('|');
}

/* Lotes em mais de um armazém (mesma filial, código e lote). */
function saDivididos() {
  const arm = $('sa-arm').value;
  const g = new Map();
  for (const l of saFiltradas('arm')) {
    if (l.saldo <= 0) continue;
    const k = `${l.filial}|${l.cod}|${l.lote}`;
    (g.get(k) || g.set(k, []).get(k)).push(l);
  }
  return [...g.values()]
    .filter(ls => ls.length > 1 && (!arm || ls.some(l => l.arm === arm)))
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
  if (!_sa.ok || !$('page-saldo-erp')) return;
  const lista = saFiltradas();

  // Cabeçalho: de quando é a foto.
  const f = _sa.foto;
  $('sa-foto').innerHTML = f
    ? `Foto do ERP de <b>${esc(fmtTS(f.ate))}</b>${f.quem ? ` · ${esc(f.quem)}` : ''}` +
      (new Date(f.ate) - new Date(f.de) > 36e5 ? ` <span class="sa-mute">(algum armazém é de ${esc(fmtTS(f.de))})</span>` : '')
    : 'Nenhuma foto do ERP importada ainda.';

  // Avisos
  const av = [];
  if (!_sa.ref.length) av.push(`<div class="aviso a-info"><span class="aviso-ico">◔</span><div><b>Sem saldo do ERP</b>
    Importe a planilha em <a href="#saldo">Saldo mapeado</a> ou ligue o robô do Excel.</div></div>`);
  if (_sa.erroDia || _sa.erroLotes) av.push(`<div class="aviso a-warn"><span class="aviso-ico">!</span><div><b>Histórico ainda não ligado</b>
    Rode o <b>sql/migracao-saldo-historico.sql</b> no Supabase. Sem ele não aparecem a evolução diária e os lotes parados; o resto da tela funciona.</div></div>`);
  $('sa-avisos').innerHTML = av.join('');

  // KPIs: uma unidade por cartão — litro, quilo e dose não se somam.
  const pu = saPorUn(lista);
  const venc = lista.filter(l => l.dias !== null && l.dias < 0 && l.saldo > 0);
  const v90  = lista.filter(l => l.dias !== null && l.dias >= 0 && l.dias <= 90 && l.saldo > 0);
  const div = saDivididos().length;
  const fora = saForaDaRegra(lista).length;
  const cards = Object.keys(pu).sort(saOrdUn).map(u => {
    const x = pu[u];
    return kpi(`Saldo em ${u}`, saQ(x.saldo),
      `livre ${saQ(x.saldo - x.emp)} · empenhado ${saQ(x.emp)}${x.temPl ? ` · ${num1(x.pl)} pl` : ''}`);
  });
  cards.push(kpi('Lotes vencidos', num(venc.length), venc.length ? saTxtUn(venc) : 'nenhum lote vencido', venc.length ? 'is-neg' : 'is-pos'));
  cards.push(kpi('Vencem em 90 dias', num(v90.length), v90.length ? saTxtUn(v90) : 'nenhum', v90.length ? 'is-warn' : ''));
  cards.push(kpi('Para arrumar', num(div + fora), `${num(div)} lote(s) em 2+ armazéns · ${num(fora)} no armazém errado`, div + fora ? 'is-alt' : 'is-pos'));
  $('sa-kpis').innerHTML = cards.join('');

  // Abas com contagem
  const n = {
    validade: venc.length, divididos: div, armazem: fora,
    parados: _sa.lotes ? saParados(lista).filter(p => p.dias >= _sa.parado && !(_sa.semD7 && p.l.arm === 'D7')).length : null,
  };
  $('sa-abas').innerHTML = SA_ABAS.map(([id, rot]) =>
    `<button role="tab" aria-selected="${_sa.aba === id}" class="${_sa.aba === id ? 'active' : ''}" onclick="saAba('${id}')">${esc(rot)}` +
    `${n[id] ? ` <span class="sa-n${id === 'validade' ? ' neg' : ''}">${num(n[id])}</span>` : ''}</button>`).join('');
  $('sa-abas').querySelector('.active')?.scrollIntoView({ block:'nearest', inline:'nearest' });

  ({ totais:saTotais, validade:saValidade, divididos:saDivTab, armazem:saArmTab, evolucao:saEvolucao, parados:saParadosTab })[_sa.aba](lista);
}

function saAba(id) { _sa.aba = id; renderSaldoErp(); }
function saSet(campo, v) { _sa[campo] = v; renderSaldoErp(); }

function saCtrlSeg(campo, opcoes, rotulo) {
  return `<div class="sa-ctrl"><span>${esc(rotulo)}</span><div class="seg">${opcoes.map(([v, t]) =>
    `<button class="${String(_sa[campo]) === String(v) ? 'active' : ''}" onclick="saSet('${campo}', ${typeof v === 'number' ? v : `'${v}'`})">${esc(t)}</button>`).join('')}</div></div>`;
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
  const filtro = { filial:null, armazem:'sa-arm', tipo:'sa-tipo' }[_sa.grupo];

  const linhas = [];
  for (const k of [...g.keys()].sort(ordem)) {
    const pu = saPorUn(g.get(k));
    const uns = Object.keys(pu).sort(saOrdUn);
    uns.forEach((u, i) => {
      const x = pu[u], p = x.saldo ? Math.max(0, Math.min(100, x.emp / x.saldo * 100)) : 0;
      const clique = filtro && i === 0 ? ` class="sa-clica" title="Filtrar por ${esc(k)}" onclick="saFiltrar('${filtro}', '${esc(k)}')"` : '';
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
function saFiltrar(sel, v) {
  if ($(sel)) { $(sel).value = v; renderSaldoErp(); toast(`Filtrando por ${v}.`); }
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
    Vagas:(_sa.vagas[`${l.cod}|${l.lote}`] || []).join(' ') }));
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
    Armazem:l.arm, Validade:saData(l.val), Dias:l.dias ?? '', Saldo:l.saldo, Unidade:l.un, Vagas:(_sa.vagas[`${l.cod}|${l.lote}`] || []).join(' ') }));
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
  const arm = $('sa-arm').value, tipo = $('sa-tipo').value, un = $('sa-un').value;
  const corte = new Date(Date.now() - _sa.periodo * 864e5).toISOString().slice(0, 10);
  // dia → unidade → {saldo, emp, venc}
  const porDia = new Map();
  for (const r of _sa.dia) {
    const d = String(r.dia).slice(0, 10);
    if (d < corte || !daFilial(r.filial) || (arm && r.armazem !== arm) || (tipo && (r.tipo || '—') !== tipo)) continue;
    const u = saUn(r.unidade);
    if (un && u !== un) continue;
    const o = porDia.get(d) || porDia.set(d, {}).get(d);
    const x = o[u] ||= { saldo:0, emp:0, venc:0 };
    x.saldo += Number(r.saldo) || 0; x.emp += Number(r.empenho) || 0; x.venc += Number(r.vencido) || 0;
  }
  const dias = [...porDia.keys()].sort();
  const uns = [...new Set(dias.flatMap(d => Object.keys(porDia.get(d))))].sort(saOrdUn);
  const busca = $('sa-busca').value.trim()
    ? '<div class="sa-resumo">A busca por produto não vale aqui: o histórico é guardado por armazém, unidade e tipo.</div>' : '';

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
  if ($('page-saldo-erp')?.classList.contains('active') && _sa.aba === 'evolucao') saDesenharGraficos();
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

/* ═══════════ EXPORTAR ═══════════ */
function exportarSaldoErp() {
  if (_sa.aba === 'totais') {
    const ls = saFiltradas(), chaveG = { filial:l => filialCurta(l.filial), armazem:l => l.arm, tipo:l => l.tipo }[_sa.grupo];
    const g = {};
    for (const l of ls) { const k = `${chaveG(l)}|${l.un}`; const x = g[k] ||= { Grupo:chaveG(l), Unidade:l.un, Lotes:0, Paletes:0, Saldo:0, Empenhado:0, Livre:0 };
      x.Lotes++; x.Paletes += l.pl || 0; x.Saldo += l.saldo; x.Empenhado += l.emp; x.Livre += l.saldo - l.emp; }
    _sa.export = () => Object.values(g);
  }
  const dados = _sa.export ? _sa.export() : [];
  if (!dados.length) { toast('Nada para exportar.', 'warn'); return; }
  const cab = Object.keys(dados[0]);
  const fmt = v => typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4).replace('.', ',') : String(v ?? '');
  const txt = [cab, ...dados.map(d => cab.map(c => fmt(d[c])))]
    .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + txt], { type:'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `saldo-${_sa.aba}-${saHoje()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${num(dados.length)} linha(s) exportada(s).`);
}
