/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · BOLETIM DO DIA (segunda aba da tela Hoje)

   Um "jornalzinho" do dia escolhido, montado só com o que já está no
   banco:
     ERP (robô das movimentações, 07:00 e 12:00) — notas de entrada e
       em qual armazém entraram, notas de saída, transferências internas
       e quem lançou;
     mapa (painel, mapa, celular) — quem guardou, moveu, expediu,
       ajustou e contou, e se o palete foi para uma linha de outro
       armazém (tabela drive_armazem, se existir);
     correções feitas pela tela Hoje.
   Copia um resumo para o WhatsApp e imprime (ou salva em PDF).

   Depende de: comum.js, saldo-erp.js (saUn, saData), analista.js
   (anCat, anTransferencias, anPl), inteligencia.js (INTEL_TIPOS).
   ═══════════════════════════════════════════════════════════════ */

const _bo = { aba:'fila', dia:null, dados:null, carregando:null, erro:null, tudo:false, saiTudo:false };
const BO_ACAO = {
  ocupou:'guardou', moveu:'moveu', expediu:'expediu', ajustou:'ajustou', liberou:'liberou a vaga',
  limpou:'limpou', separou:'separou', retornou:'devolveu ao mapa', editou:'editou',
  contou:'contou', transferiu:'transferiu',
};
const BO_UNS = ['L', 'KG', 'DS'];

/* ═══════════ ABA ═══════════ */
try { _bo.aba = localStorage.getItem('hj.aba') === 'boletim' ? 'boletim' : 'fila'; } catch (e) {}
function hjAba(a) {
  _bo.aba = a === 'boletim' ? 'boletim' : 'fila';
  try { localStorage.setItem('hj.aba', _bo.aba); } catch (e) {}
  hjPintarAba();
  if (_bo.aba === 'boletim') boCarregar(false);
}
function hjPintarAba() {
  document.querySelectorAll('#hj-abas button').forEach(b => b.classList.toggle('active', b.dataset.a === _bo.aba));
  const f = $('hj-corpo'), b = $('hj-boletim');
  if (f) f.hidden = _bo.aba === 'boletim';
  if (b) b.hidden = _bo.aba !== 'boletim';
}
function hjAtualizar() {
  if (_bo.aba === 'boletim') boCarregar(true); else carregarHoje(true);
}
// Abrir a tela Hoje também carrega o boletim, se for a aba escolhida.
if (typeof carregarHoje === 'function') {
  const _carregarHojeFila = carregarHoje;
  carregarHoje = async function (forcar = false) {
    hjPintarAba();
    if (_bo.aba === 'boletim') boCarregar(forcar);
    return _carregarHojeFila(forcar);
  };
}

/* ═══════════ DATAS ═══════════ */
const boIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const boHoje = () => boIso(new Date());
const boDiaDe = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
function boMudarDia(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  if (iso > boHoje()) iso = boHoje();
  _bo.dia = iso; _bo.tudo = false; _bo.saiTudo = false; boCarregar(true);
}
function boPasso(n) { const d = boDiaDe(_bo.dia || boHoje()); d.setDate(d.getDate() + n); boMudarDia(boIso(d)); }
const boHora = ts => { const d = new Date(ts); return isNaN(d) ? '—' : d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }); };
const boDiaLongo = iso => { const s = boDiaDe(iso).toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
const boDiaCurto = iso => boDiaDe(iso).toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });

/* ═══════════ CARGA ═══════════ */
async function boCarregar(forcar = false) {
  const el = $('hj-boletim');
  if (!el) return;
  if (!_bo.dia) _bo.dia = boHoje();
  if (_bo.carregando) return _bo.carregando;
  if (!forcar && _bo.dados && _bo.dados.dia === _bo.dia && Date.now() - _bo.dados.quando < 120000) { boRender(); return; }
  if (!_bo.dados || _bo.dados.dia !== _bo.dia) el.innerHTML = boControles() + '<div class="skeleton">montando o boletim…</div>';
  const dia = _bo.dia, d0 = boDiaDe(dia), d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const i0 = d0.toISOString(), i1 = d1.toISOString();
  const tenta = p => p.then(d => ({ d }), e => ({ e }));
  const res1 = q => q.then(({ data, error }) => { if (error) throw error; return data; });
  _bo.carregando = (async () => {
    const [erp, sync, alt, lanc, tf, dec, hist, pend, regras] = await Promise.all([
      tenta(buscarTudo(() => sb.from('erp_mov').select('*').eq('emissao', dia).order('id'))),
      tenta(res1(sb.from('erp_mov_sync').select('quando, de, ate, linhas').order('quando', { ascending:false }).limit(1).maybeSingle())),
      tenta(buscarTudo(() => sb.from('alteracoes').select('*').gte('created_at', i0).lt('created_at', i1).order('created_at'))),
      tenta(buscarTudo(() => sb.from('lancamentos').select('id, usuario, posicao, codigo, produto_nome, lote, armazem, quantidade, status, recontagem, created_at').gte('created_at', i0).lt('created_at', i1).order('created_at'))),
      tenta(buscarTudo(() => sb.from('transferencias').select('*').gte('concluido_em', i0).lt('concluido_em', i1))),
      tenta(buscarTudo(() => sb.from('inteligencia_decisao').select('id, quando, quem, tipo, decisao, detalhes').gte('quando', i0).lt('quando', i1).order('quando'))),
      tenta(buscarTudo(() => sb.from('historico').select('posicao, codigo, lote, armazem, quantidade').eq('ocupacao_ativa', true).not('posicao', 'is', null))),
      tenta(buscarTudo(() => sb.from('lancamentos').select('posicao, codigo, lote, armazem, quantidade').eq('status', 'pendente').eq('ocupacao_ativa', true).not('posicao', 'is', null))),
      tenta(buscarTudo(() => sb.from('drive_armazem').select('linha, armazens'))),
    ]);
    const erpRows = (erp.d || []).filter(r => r.movest !== false && (typeof daFilial !== 'function' || daFilial(r.filial)));
    for (const r of erpRows) { r.un = typeof saUn === 'function' ? saUn(r.um) : String(r.um || '').toUpperCase(); r.arm = normalizarArmazem(r.armazem); }
    // Onde cada lote está no mapa agora.
    const mapa = new Map();
    for (const r of [...(hist.d || []), ...(pend.d || [])]) {
      const k = `${normalizarCodigo(r.codigo)}|${chave(r.lote)}`;
      (mapa.get(k) || mapa.set(k, []).get(k)).push(r);
    }
    _bo.dados = {
      dia, quando:Date.now(), erp:erpRows, erroErp:erp.e || null, sync:sync.d || null,
      alt:alt.d || [], erroAlt:alt.e || null, lanc:lanc.d || [], tf:tf.d || [], dec:(dec.d || []).filter(x => x.decisao === 'aplicou'),
      mapa, erroMapa:hist.e || null,
      regras:regras.e ? null : new Map((regras.d || []).map(x => [String(x.linha).toUpperCase(), (x.armazens || []).map(normalizarArmazem)])),
    };
    _bo.erro = null;
  })();
  try { await _bo.carregando; }
  catch (e) { _bo.erro = e; }
  finally { _bo.carregando = null; }
  boRender();
}

/* ═══════════ CONTAS ═══════════ */
const boQ = n => num(Math.round((Number(n) || 0) * 100) / 100);
function boSomaUn(rows) {
  const q = {};
  for (const r of rows) { const u = r.un || 'UN'; q[u] = (q[u] || 0) + (Number(r.quantidade) || 0); }
  return q;
}
const boQtd = q => [...BO_UNS, ...Object.keys(q).filter(u => !BO_UNS.includes(u))].filter(u => q[u]).map(u => `${boQ(q[u])} ${u}`).join(' · ') || '—';
const boNF = r => `${r.filial}|${r.nf || r.sequencia || ''}|${r.serie || ''}`;
function boNotas(rows) {
  const g = new Map();
  for (const r of rows) { const k = boNF(r); (g.get(k) || g.set(k, []).get(k)).push(r); }
  return [...g.values()].map(rs => {
    const r = rs[0];
    return { nf:r.nf, serie:r.serie, filial:r.filial, cli:r.cli_nome, uf:r.cli_uf, tes:r.tes_desc, pedido:r.pedido, usuario:rs.find(x => x.usuario)?.usuario || '',
      cat:typeof anCat === 'function' ? anCat(r) : (r.tes_desc || ''), itens:rs, q:boSomaUn(rs), valor:rs.reduce((a, x) => a + (Number(x.valor) || 0), 0),
      pl:rs.reduce((a, x) => a + (typeof anPl === 'function' ? anPl(x) : Number(x.paletes) || 0), 0), arms:[...new Set(rs.map(x => x.arm).filter(Boolean))] };
  });
}
// Linha do drive-in de uma posição ('B1-07-2-3' → 'B1-07') e se o armazém bate com a regra.
function boForaDaLinha(pos, arm, regras) {
  if (!regras || !pos || !arm) return null;
  const m = String(pos).toUpperCase().match(/^([A-Z]+\d*)-(\d+)-\d+-\d+$/); if (!m) return null;
  const k = `${m[1]}-${m[2].padStart(2, '0')}`, rg = regras.get(k);
  if (!rg || !rg.length || rg.includes(normalizarArmazem(arm))) return null;
  return { linha:k, rg };
}
function boCalcular() {
  const D = _bo.dados;
  const ent = D.erp.filter(r => r.tipo_mov === 'Entrada'), sai = D.erp.filter(r => r.tipo_mov === 'Saída');
  const notasEnt = boNotas(ent).sort((a, b) => String(a.nf).localeCompare(String(b.nf)));
  // Maior primeiro: palete equivalente não mistura litro com dose.
  const notasSai = boNotas(sai).sort((a, b) => (b.pl - a.pl) || (b.valor - a.valor));
  const trans = typeof anTransferencias === 'function' ? anTransferencias(D.erp) : [];
  // No mapa: o que cada pessoa fez (painel + mapa + celular), numa linha do tempo só.
  const ev = [];
  for (const a of D.alt) ev.push({ quando:a.created_at, quem:a.quem || 'sem nome', acao:a.acao, pos:a.posicao, cod:a.codigo, prod:a.produto_nome, lote:a.lote, arm:a.armazem,
    antes:a.qtd_antes, depois:a.qtd_depois, obs:a.obs, fonte:'painel' });
  for (const l of D.lanc) ev.push({ quando:l.created_at, quem:l.usuario || 'sem nome', acao:'contou', pos:l.posicao, cod:l.codigo, prod:l.produto_nome, lote:l.lote, arm:l.armazem,
    depois:l.quantidade, rec:!!l.recontagem, status:l.status, fonte:'celular' });
  for (const t of D.tf) ev.push({ quando:t.concluido_em, quem:t.concluido_por || 'sem nome', acao:'transferiu', pos:t.posicao_destino, de:t.posicao_origem, cod:t.codigo, prod:t.produto_nome, lote:t.lote,
    arm:t.armazem_destino, armDe:t.armazem_origem, depois:t.quantidade_movida ?? t.quantidade, fonte:'celular' });
  ev.sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  for (const e of ev) if (['ocupou', 'moveu', 'contou', 'transferiu', 'retornou', 'editou'].includes(e.acao)) e.fora = boForaDaLinha(e.pos, e.arm, D.regras);
  const pessoas = new Map();
  for (const e of ev) { const p = pessoas.get(e.quem) || pessoas.set(e.quem, { n:0, ac:{} }).get(e.quem); p.n++; p.ac[e.acao] = (p.ac[e.acao] || 0) + 1; }
  // Entradas: o lote já está no mapa?
  for (const n of notasEnt) for (const r of n.itens) r.noMapa = D.mapa.get(`${normalizarCodigo(r.codigo)}|${chave(r.lote)}`) || [];
  const naoMapeados = notasEnt.flatMap(n => n.itens).filter(r => !r.noMapa.length);
  const fora = ev.filter(e => e.fora);
  return { ent, sai, notasEnt, notasSai, trans, ev, pessoas, naoMapeados, fora,
    clientes:new Set(notasSai.map(n => n.cli).filter(Boolean)), faturadas:notasSai.filter(n => typeof anFaturado === 'function' ? anFaturado(n.itens[0]) : true) };
}
function boLide(C, dia) {
  const p = [];
  if (C.notasEnt.length) p.push(`entraram <b>${num(C.notasEnt.length)}</b> nota${C.notasEnt.length > 1 ? 's' : ''} (${boQtd(boSomaUn(C.ent))})`);
  if (C.notasSai.length) p.push(`saíram <b>${num(C.notasSai.length)}</b> nota${C.notasSai.length > 1 ? 's' : ''} para <b>${num(C.clientes.size)}</b> cliente${C.clientes.size === 1 ? '' : 's'} (${boQtd(boSomaUn(C.sai))})`);
  if (C.trans.length) p.push(`<b>${num(C.trans.length)}</b> movimento${C.trans.length > 1 ? 's' : ''} interno${C.trans.length > 1 ? 's' : ''} no ERP`);
  const nMapa = C.ev.length, nP = C.pessoas.size;
  if (nMapa) p.push(`<b>${num(nMapa)}</b> movimentaç${nMapa > 1 ? 'ões' : 'ão'} no mapa, feitas por <b>${num(nP)}</b> pessoa${nP > 1 ? 's' : ''}`);
  if (!p.length) return dia === boHoje() ? 'Ainda nada registrado hoje.' : 'Nenhum movimento registrado neste dia.';
  const sem = boDiaDe(dia).toLocaleDateString('pt-BR', { weekday:'long' });
  const abre = dia === boHoje() ? 'Hoje' : `${/^(sábado|domingo)/.test(sem) ? 'No' : 'Na'} ${sem},`;
  return `${abre} ${p.length > 1 ? p.slice(0, -1).join(', ') + ' e ' + p.at(-1) : p[0]}.`;
}
function boDestaques(C) {
  const d = [];
  if (C.naoMapeados.length) {
    const lotes = [...new Set(C.naoMapeados.map(r => r.lote).filter(Boolean))];
    d.push({ t:'neg', h:`<b>${num(lotes.length)}</b> lote${lotes.length > 1 ? 's' : ''} que ${lotes.length > 1 ? 'entraram' : 'entrou'} por nota ainda não ${lotes.length > 1 ? 'estão' : 'está'} no mapa: ${lotes.slice(0, 6).map(l => `<span class="mono">${esc(l)}</span>`).join(', ')}${lotes.length > 6 ? '…' : ''}.` });
  }
  if (C.fora.length) d.push({ t:'neg', h:`<b>${num(C.fora.length)}</b> palete${C.fora.length > 1 ? 's foram guardados' : ' foi guardado'} numa linha de outro armazém (${[...new Set(C.fora.map(e => e.fora.linha))].slice(0, 5).map(esc).join(', ')}).` });
  const lib = C.trans.filter(t => /quarentena/i.test(t.rota));
  if (lib.length) d.push({ t:'pos', h:`<b>${num(lib.length)}</b> liberaç${lib.length > 1 ? 'ões' : 'ão'} da quarentena (${boQtd(boSomaUn(lib.map(t => t.base)))}).` });
  const venc = C.trans.filter(t => /vencidos|descarte|avaria/i.test(t.rota));
  if (venc.length) d.push({ t:'warn', h:`<b>${num(venc.length)}</b> movimento${venc.length > 1 ? 's' : ''} para vencidos, avaria ou descarte (${boQtd(boSomaUn(venc.map(t => t.base)))}).` });
  const maior = C.notasSai.find(n => n.cat === 'Venda' || n.cat === 'Exportação') || C.notasSai[0];
  if (maior) d.push({ t:'info', h:`Maior nota de saída: <b>NF ${esc(maior.nf || '—')}</b> para ${esc(maior.cli || '—')}${maior.uf ? '/' + esc(maior.uf) : ''} — ${boQtd(maior.q)}${maior.pl ? `, ${num1(maior.pl)} palete(s)` : ''}.` });
  const top = [...C.pessoas].sort((a, b) => b[1].n - a[1].n)[0];
  if (top && C.pessoas.size > 1) d.push({ t:'info', h:`Quem mais movimentou o mapa: <b>${esc(top[0])}</b> (${num(top[1].n)}).` });
  const pendentes = C.ev.filter(e => e.acao === 'contou' && e.status === 'pendente').length;
  if (pendentes) d.push({ t:'warn', h:`<b>${num(pendentes)}</b> contage${pendentes > 1 ? 'ns' : 'm'} do celular ainda esperando validação.` });
  return d;
}

/* ═══════════ TELA ═══════════ */
function boControles() {
  const dia = _bo.dia || boHoje(), hoje = boHoje();
  return `<div class="bo-ctrl">
    <div class="bo-dia">
      <button class="btn btn-sm" onclick="boPasso(-1)" title="Dia anterior" aria-label="Dia anterior">‹</button>
      <input type="date" class="input bo-data" value="${dia}" max="${hoje}" onchange="boMudarDia(this.value)" aria-label="Dia do boletim">
      <button class="btn btn-sm" onclick="boPasso(1)" ${dia >= hoje ? 'disabled' : ''} title="Próximo dia" aria-label="Próximo dia">›</button>
      ${dia !== hoje ? `<button class="btn btn-sm btn-ghost" onclick="boMudarDia(boHoje())">Hoje</button>` : ''}
    </div>
    <div class="btn-row"><button class="btn btn-sm" onclick="boCopiar()">Copiar para WhatsApp</button><button class="btn btn-sm" onclick="boImprimir()">Imprimir / PDF</button></div>
  </div>`;
}
function boSec(tit, nota, corpo, id = '') {
  return `<section class="bo-sec"${id ? ` id="${id}"` : ''}><div class="bo-sec-h"><h2>${tit}</h2>${nota ? `<span>${nota}</span>` : ''}</div>${corpo}</section>`;
}
function boRender() {
  const el = $('hj-boletim');
  if (!el) return;
  if (_bo.erro) { el.innerHTML = boControles() + `<div class="empty"><div class="empty-tit">Não foi possível montar o boletim</div><div class="empty-sub">${esc(_bo.erro.message || String(_bo.erro))}</div></div>`; return; }
  const D = _bo.dados; if (!D) return;
  const C = boCalcular(), dia = D.dia;
  _bo.calc = C;
  const sync = D.sync?.quando ? `ERP até ${esc(fmtTS(D.sync.quando))}` : 'ERP sem envio do robô';
  const avisos = [];
  if (D.erroErp) avisos.push('As notas e transferências do ERP não chegam: rode o <code>sql/migracao-movimentos.sql</code> e instale o robô das movimentações.');
  else if (dia === boHoje() && D.sync?.quando) avisos.push(`O robô manda o ERP às 07:00 e às 12:00 — o que foi lançado no ERP depois de ${esc(boHora(D.sync.quando))} entra no próximo envio.`);
  if (D.erroAlt) avisos.push('Não consegui ler as alterações do mapa (' + esc(D.erroAlt.message || '') + ').');

  const kpi = (v, t, p, cls = '') => `<div class="bo-num ${cls}"><b>${v}</b><span>${t}</span>${p ? `<small>${p}</small>` : ''}</div>`;
  const nCont = C.ev.filter(e => e.acao === 'contou').length, nAlt = C.ev.length - nCont;
  const numeros = `<div class="bo-nums">
    ${kpi(num(C.notasEnt.length), 'notas de entrada', boQtd(boSomaUn(C.ent)))}
    ${kpi(num(C.notasSai.length), 'notas de saída', C.clientes.size ? `${num(C.clientes.size)} cliente(s) · ${boQtd(boSomaUn(C.sai))}` : '')}
    ${kpi(num(C.trans.length), 'movimentos internos', 'transferências no ERP')}
    ${kpi(num(nAlt), 'movimentos no mapa', C.pessoas.size ? `${num(C.pessoas.size)} pessoa(s)` : '')}
    ${kpi(num(nCont), 'contagens no celular', '')}
  </div>`;
  const dest = boDestaques(C);

  // Entradas: uma ficha por nota.
  const ent = C.notasEnt.length ? C.notasEnt.map(n => `<article class="bo-nf">
      <div class="bo-nf-h"><b>NF ${esc(n.nf || '—')}</b>${n.serie ? `<span class="mono">série ${esc(n.serie)}</span>` : ''}<span class="tag t-mute">${esc(n.tes || 'entrada')}</span><span class="bo-nf-arm">entrou no armazém <b>${n.arms.map(esc).join(', ') || '—'}</b></span></div>
      <div class="bo-nf-sub">${esc(n.cli || 'fornecedor não informado')}${n.uf ? '/' + esc(n.uf) : ''} · filial ${esc(n.filial)}${n.usuario ? ` · lançada por <b>${esc(n.usuario)}</b>` : ''} · ${boQtd(n.q)}${n.valor ? ` · ${typeof anR === 'function' ? anR(n.valor) : num(n.valor)}` : ''}</div>
      <div class="tbl-wrap"><table class="tbl bo-tbl"><thead><tr><th>Produto</th><th>Lote</th><th class="num">Quantidade</th><th>Arm.</th><th>No mapa agora</th></tr></thead><tbody>
      ${n.itens.map(r => `<tr><td class="nome">${esc(r.descricao || r.codigo)}<div class="sub mono">${esc(r.codigo)}</div></td><td class="mono">${esc(r.lote || '—')}</td>
        <td class="num">${boQ(r.quantidade)} <small class="sa-un">${esc(r.un)}</small></td><td class="mono"><b>${esc(r.arm || '—')}</b></td>
        <td>${r.noMapa.length ? `<span class="tag t-ok t-mono">${esc(r.noMapa[0].posicao)}</span>${r.noMapa.length > 1 ? ` <span class="sub">+${r.noMapa.length - 1}</span>` : ''}` : '<span class="tag t-warn">ainda não</span>'}</td></tr>`).join('')}
      </tbody></table></div></article>`).join('')
    : `<p class="bo-vazio">${D.erroErp ? 'Sem dados do ERP.' : 'Nenhuma nota de entrada neste dia.'}</p>`;

  // Saídas: uma linha por nota; os itens abrem embaixo.
  const sai = C.notasSai.length ? `<div class="tbl-wrap"><table class="tbl bo-tbl"><thead><tr><th>NF</th><th>Cliente</th><th>Tipo</th><th class="num">Itens</th><th class="num">Quantidade</th><th class="num">Paletes</th><th>Arm.</th></tr></thead><tbody>
      ${C.notasSai.slice(0, _bo.saiTudo ? Infinity : 20).map((n, i) => `<tr class="bo-abre" onclick="boAbrir(this)" tabindex="0" onkeydown="if(event.key==='Enter')boAbrir(this)"><td class="mono bo-nfcol"><b>${esc(n.nf || '—')}</b>${n.pedido ? `<div class="sub">pedido ${esc(n.pedido)}</div>` : ''}</td><td class="nome">${esc(n.cli || '—')}${n.uf ? `<span class="sub"> /${esc(n.uf)}</span>` : ''}</td>
        <td><span class="tag ${n.cat === 'Venda' || n.cat === 'Exportação' ? 't-info' : 't-mute'}">${esc(n.cat)}</span></td><td class="num">${n.itens.length}</td><td class="num bo-nw">${boQtd(n.q)}</td><td class="num">${n.pl ? num1(n.pl) : '—'}</td><td class="mono">${n.arms.map(esc).join(', ')}</td></tr>
        <tr class="bo-itens" hidden><td colspan="7"><ul>${n.itens.map(r => `<li><b>${esc(r.descricao || r.codigo)}</b> · lote <span class="mono">${esc(r.lote || '—')}</span> · ${boQ(r.quantidade)} ${esc(r.un)} · arm. ${esc(r.arm)}</li>`).join('')}</ul>${n.tes ? `<div class="sub">${esc(n.tes)}${n.usuario ? ` · ${esc(n.usuario)}` : ''}</div>` : ''}</td></tr>`).join('')}
    </tbody></table></div>${C.notasSai.length > 20 && !_bo.saiTudo ? `<div class="bo-mais"><button class="btn btn-sm" onclick="_bo.saiTudo=true;boRender()">Mostrar as ${num(C.notasSai.length)} notas</button></div>` : ''}`
    : `<p class="bo-vazio">${D.erroErp ? 'Sem dados do ERP.' : 'Nenhuma nota de saída neste dia.'}</p>`;

  // Transferências do ERP.
  const tr = C.trans.length ? `<ul class="bo-lista">${C.trans.map(t => `<li><span class="tag t-mute">${esc(t.rota)}</span>
      <b>${esc(t.base.descricao || t.base.codigo)}</b>${t.codDif ? ` <span class="sub">vira ${esc(t.e.descricao || t.e.codigo)}</span>` : ''} · lote <span class="mono">${esc(t.base.lote || '—')}</span> · ${boQ(t.qtd)} ${esc(t.un)}
      · <span class="mono bo-rota">${esc(t.de)} → ${esc(t.para)}</span>${t.doc ? ` · doc <span class="mono">${esc(t.doc)}</span>` : ''}${t.usuario ? ` · por <b>${esc(t.usuario)}</b>` : ''}</li>`).join('')}</ul>`
    : `<p class="bo-vazio">${D.erroErp ? 'Sem dados do ERP.' : 'Nenhuma transferência interna neste dia.'}</p>`;

  // Pessoas e linha do tempo do mapa.
  const ps = [...C.pessoas].sort((a, b) => b[1].n - a[1].n);
  const pessoas = ps.length ? `<div class="bo-pessoas">${ps.map(([q, p]) => `<div class="bo-pessoa"><div class="bo-av">${esc(iniciais(q))}</div><div><b>${esc(q)}</b><div class="sub">${Object.entries(p.ac).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${esc(BO_ACAO[a] || a)} ${num(n)}`).join(' · ')}</div></div></div>`).join('')}</div>` : '';
  const lim = _bo.tudo ? C.ev.length : 40, evs = [...C.ev].reverse().slice(0, lim);
  const qtdEv = e => e.acao === 'ajustou' || (e.antes != null && e.depois != null && e.antes !== e.depois) ? `${e.antes != null ? boQ(e.antes) + ' → ' : ''}${boQ(e.depois)}` : e.depois != null ? boQ(e.depois) : e.antes != null ? boQ(e.antes) : '—';
  const linha = evs.length ? `<div class="tbl-wrap"><table class="tbl bo-tbl"><thead><tr><th>Hora</th><th>Quem</th><th>O quê</th><th>Onde</th><th>Produto</th><th>Lote</th><th>Arm.</th><th class="num">Qtd.</th></tr></thead><tbody>
      ${evs.map(e => `<tr${e.fora ? ' class="bo-fora"' : ''}><td class="mono">${esc(boHora(e.quando))}</td><td>${esc(e.quem)}</td><td>${esc(BO_ACAO[e.acao] || e.acao)}${e.rec ? ' <span class="sub">(recontagem)</span>' : ''}${e.acao === 'contou' && e.status === 'pendente' ? ' <span class="tag t-warn">a validar</span>' : ''}</td>
        <td class="mono">${e.de ? `${esc(e.de)} → ` : ''}${esc(e.pos || '—')}${e.fora ? `<div class="bo-fora-txt">linha ${esc(e.fora.linha)} é do ${esc(e.fora.rg.join(' · '))}</div>` : ''}</td>
        <td class="nome">${esc(e.prod || e.cod || '—')}</td><td class="mono">${esc(e.lote || '—')}</td><td class="mono">${e.armDe ? `${esc(e.armDe)} → ` : ''}${esc(e.arm || '—')}</td><td class="num">${qtdEv(e)}</td></tr>`).join('')}
    </tbody></table></div>${C.ev.length > lim ? `<div class="bo-mais"><button class="btn btn-sm" onclick="_bo.tudo=true;boRender()">Mostrar as ${num(C.ev.length)} movimentações</button></div>` : ''}`
    : '<p class="bo-vazio">Ninguém mexeu no mapa neste dia.</p>';

  const dec = D.dec.length ? `<ul class="bo-lista">${D.dec.map(x => `<li><span class="mono">${esc(boHora(x.quando))}</span> · <b>${esc(x.quem || '—')}</b> · ${esc((typeof INTEL_TIPOS === 'object' && INTEL_TIPOS[x.tipo]?.rot) || x.tipo)}${x.detalhes?.acao ? ` — ${esc(x.detalhes.acao)}` : ''}${x.detalhes?.lote ? ` · lote <span class="mono">${esc(x.detalhes.lote)}</span>` : ''}</li>`).join('')}</ul>` : '';

  el.innerHTML = boControles() + `<article class="bo" id="bo-folha">
    <header class="bo-cab"><div class="bo-selo">Boletim do estoque</div><h1>${esc(boDiaLongo(dia))}</h1>
      <div class="bo-meta">Simbiose Agro · ${sync} · mapa até ${esc(boHora(D.quando))}${(USUARIO?.nome || QUEM) ? ` · por ${esc(USUARIO?.nome || QUEM)}` : ''}</div></header>
    ${avisos.map(a => `<div class="bo-aviso">${a}</div>`).join('')}
    <p class="bo-lide">${boLide(C, dia)}</p>
    ${numeros}
    ${dest.length ? `<ul class="bo-dest">${dest.map(x => `<li class="bo-d-${x.t}">${x.h}</li>`).join('')}</ul>` : ''}
    ${boSec('Entrou', C.notasEnt.length ? `${num(C.notasEnt.length)} nota(s) · ${boQtd(boSomaUn(C.ent))}` : '', ent, 'bo-ent')}
    ${boSec('Saiu', C.notasSai.length ? `${num(C.notasSai.length)} nota(s) · ${num(C.clientes.size)} cliente(s) · clique na nota para ver os itens` : '', sai, 'bo-sai')}
    ${boSec('Mudou de armazém no ERP', C.trans.length ? `${num(C.trans.length)} movimento(s)` : '', tr, 'bo-int')}
    ${boSec('No mapa: quem fez o quê', C.ev.length ? `${num(C.ev.length)} movimentação(ões) · ${num(C.pessoas.size)} pessoa(s)` : '', pessoas + linha, 'bo-mapa')}
    ${dec ? boSec('Correções feitas pela tela Hoje', `${num(D.dec.length)}`, dec, 'bo-dec') : ''}
    <footer class="bo-rod">Montado em ${esc(new Date().toLocaleString('pt-BR'))} com o que estava no sistema. O ERP chega pelo robô das movimentações; o mapa, na hora.</footer>
  </article>`;
}
function boAbrir(tr) {
  const it = tr.nextElementSibling; if (!it?.classList.contains('bo-itens')) return;
  it.hidden = !it.hidden; tr.classList.toggle('aberta', !it.hidden);
}

/* ═══════════ COPIAR (WhatsApp) E IMPRIMIR ═══════════ */
function boTexto() {
  const D = _bo.dados, C = _bo.calc || boCalcular(); if (!D) return '';
  const tira = h => String(h).replace(/<b>|<\/b>/g, '*').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const L = [`*Boletim do estoque — ${boDiaCurto(D.dia)}*`, '', tira(boLide(C, D.dia))];
  const dest = boDestaques(C);
  if (dest.length) { L.push(''); dest.forEach(d => L.push('• ' + tira(d.h))); }
  if (C.notasEnt.length) {
    L.push('', `*Entrou (${C.notasEnt.length} nota${C.notasEnt.length > 1 ? 's' : ''})*`);
    for (const n of C.notasEnt) {
      L.push(`NF ${n.nf || '—'} · ${n.cli || '—'} · ${n.tes || 'entrada'} → arm. ${n.arms.join(', ') || '—'}`);
      for (const r of n.itens) L.push(`   - ${r.descricao || r.codigo} · lote ${r.lote || '—'} · ${boQ(r.quantidade)} ${r.un} · ${r.noMapa.length ? 'no mapa ' + r.noMapa[0].posicao : 'ainda não no mapa'}`);
    }
  }
  if (C.notasSai.length) {
    L.push('', `*Saiu (${C.notasSai.length} nota${C.notasSai.length > 1 ? 's' : ''}, ${C.clientes.size} cliente${C.clientes.size === 1 ? '' : 's'})* — ${boQtd(boSomaUn(C.sai))}`);
    for (const n of C.notasSai.slice(0, 15)) L.push(`NF ${n.nf || '—'} · ${n.cli || '—'}${n.uf ? '/' + n.uf : ''} · ${boQtd(n.q)}`);
    if (C.notasSai.length > 15) L.push(`… e mais ${C.notasSai.length - 15}`);
  }
  if (C.trans.length) {
    L.push('', `*Mudou de armazém no ERP (${C.trans.length})*`);
    for (const t of C.trans) L.push(`${t.rota}: ${t.base.descricao || t.base.codigo} · lote ${t.base.lote || '—'} · ${boQ(t.qtd)} ${t.un} · ${t.de} → ${t.para}${t.usuario ? ' · ' + t.usuario : ''}`);
  }
  if (C.pessoas.size) {
    L.push('', `*No mapa (${C.ev.length})*`);
    for (const [q, p] of [...C.pessoas].sort((a, b) => b[1].n - a[1].n)) L.push(`${q}: ${Object.entries(p.ac).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${BO_ACAO[a] || a} ${n}`).join(', ')}`);
  }
  if (D.dec.length) L.push('', `*Correções pelo Hoje:* ${D.dec.length}`);
  return L.join('\n');
}
function boCopiar() {
  const t = boTexto(); if (!t) return;
  const velho = () => {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Boletim copiado — é só colar no WhatsApp.'); } catch (e) { toast('Não consegui copiar daqui.', 'warn'); }
    ta.remove();
  };
  if (!navigator.clipboard?.writeText) return velho();
  navigator.clipboard.writeText(t).then(() => toast('Boletim copiado — é só colar no WhatsApp.'), velho);
}
function boImprimir() {
  // No papel vão todas as notas de saída (uma linha por nota) e todas as movimentações do mapa.
  if (!_bo.saiTudo || !_bo.tudo){ _bo.saiTudo = true; _bo.tudo = true; boRender(); }
  document.body.classList.add('bo-imprimindo');
  // O painel só imprime a caixa #impressao (impressao.js): o boletim vai para lá.
  const box = typeof caixaImpressao === 'function' ? caixaImpressao() : null, folha = $('bo-folha');
  if (box && folha){ const c = folha.cloneNode(true); c.removeAttribute('id'); box.innerHTML = ''; box.appendChild(c); }
  // Papel é sempre claro, mesmo com a tela no tema escuro.
  const h = document.documentElement, tema = h.getAttribute('data-tema');
  h.setAttribute('data-tema', 'claro');
  const t = document.title; document.title = `Boletim ${_bo.dia || ''}`;
  addEventListener('afterprint', () => { document.body.classList.remove('bo-imprimindo'); document.title = t; if (tema) h.setAttribute('data-tema', tema); if (box) box.innerHTML = ''; }, { once:true });
  print();
}
