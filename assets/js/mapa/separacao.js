/* ═══════════════════════════════════════════════════════════════
   PEDIDOS SEPARADOS (mapa.html)
   O palete sai do drive-in para a área de separação e fica lá até
   carregar. No ERP ele continua no mesmo armazém (empenhado), então
   não pode sumir do mapa: fica aqui, e o Saldo mapeado conta.

   Saídas de cada item:
     · Expedir              → carregou/faturou; sai do mapa
     · Retornar ao depósito → volta para uma vaga do drive-in

   "Parece faturado": a planilha do ERP importada DEPOIS da
   separação mostra o lote com o saldo caído (ou sem o lote). É só
   aviso — quem expede é a pessoa.

   Tabela: separacao (sql/migracao-separacao.sql).
   ═══════════════════════════════════════════════════════════════ */

/* Rótulos das ações da separação na trilha de alterações. */
if (typeof ACOES === 'object') Object.assign(ACOES, {
  separou:  { rot:'Mandou para a separação', cor:'warn' },
  retornou: { rot:'Voltou da separação',     cor:'pos'  },
});

const SEP_DIAS_PARADO = 3;
const SEP_LUGAR = 'SEPARAÇÃO';

let _sep       = [];        // itens com status 'separado'
let _sepOk     = true;      // a tabela existe?
let _vista     = 'drive';   // 'drive' | 'sep'
let _sepFiltro = 'todos';   // 'todos' | 'parados' | 'faturado'
let _sepQ      = '';
let _sepDlg    = null;      // { modo, item, pos?, max }

const numBR = v => Number(String(v ?? '').trim().replace(/\./g, '').replace(',', '.'));
const pedidoDe = r => String(r.pedido || '').trim().toUpperCase();

/* ── carga ───────────────────────────────────────────────────── */
async function carregarSeparacao() {
  try {
    const { data, error } = await sb.from('separacao').select('*').eq('status', 'separado').order('separado_em');
    if (error) throw error;
    _sep = data || [];
    _sepOk = true;
    await marcarFaturados();
  } catch (e) {
    _sep = []; _sepOk = false;
    console.warn('separação:', e.message);
  }
  pintarContadorSep();
  if (_vista === 'sep') renderSeparados();
}

/* Compara cada item com a planilha do ERP importada depois dele. */
async function marcarFaturados() {
  for (const r of _sep) { r._faturado = false; r._dias = diasDesde(r.separado_em); }
  if (!_sep.length) return;
  let ref = [];
  try {
    const cods = [...new Set(_sep.map(r => normalizarCodigo(r.codigo)))];
    const arms = [...new Set(_sep.map(r => normalizarArmazem(r.armazem)).filter(Boolean))];
    const [doLote, fotos] = await Promise.all([
      buscarTudo(() => sb.from('estoque_ref').select('codigo, lote, armazem, saldo').in('codigo', cods)),
      // data da planilha mais nova de cada armazém dos itens
      Promise.all(arms.map(a => sb.from('estoque_ref').select('importado_em').eq('armazem', a)
        .order('importado_em', { ascending:false }).limit(1).then(({ data }) => [a, data?.[0]?.importado_em || null]))),
    ]);
    ref = doLote;
    const fotoArm = Object.fromEntries(fotos);
    const saldo = new Map();
    for (const s of ref) {
      const k = `${chave(normalizarCodigo(s.codigo))}|${chave(s.lote)}|${normalizarArmazem(s.armazem)}`;
      saldo.set(k, (saldo.get(k) || 0) + (Number(s.saldo) || 0));
    }
    // Itens do mesmo lote, com a mesma base, somam: se o saldo caiu
    // 500 e há dois de 300 separados, só o primeiro "parece faturado".
    const grupos = new Map();
    for (const r of _sep) {
      const arm = normalizarArmazem(r.armazem);
      const k = `${chave(normalizarCodigo(r.codigo))}|${chave(r.lote)}|${arm}`;
      const foto = fotoArm[arm];
      const base = r.foto_erp_em || r.separado_em;
      if (!foto || foto <= base) continue;              // planilha ainda não é posterior
      const g = `${k}|${r.saldo_erp_antes ?? '-'}`;
      (grupos.get(g) || grupos.set(g, { k, antes:r.saldo_erp_antes, itens:[] }).get(g)).itens.push(r);
    }
    for (const { k, antes, itens } of grupos.values()) {
      const atual = saldo.get(k);
      if (atual === undefined) { itens.forEach(r => { r._faturado = true; }); continue; }   // lote sumiu
      if (antes === null || antes === undefined) continue;
      const caiu = Number(antes) - atual;
      let acum = 0;
      for (const r of itens.sort((a, b) => String(a.separado_em).localeCompare(String(b.separado_em)))) {
        acum += Number(r.quantidade) || 0;
        if (caiu >= acum - 0.001) r._faturado = true;
      }
    }
  } catch { /* sem planilha: sem aviso */ }
}

function pintarContadorSep() {
  const n = _sep.length;
  const el = $('vt-n');
  if (el) { el.textContent = n ? num(n) : ''; el.classList.toggle('alerta', _sep.some(r => r._faturado || r._dias > SEP_DIAS_PARADO)); }
}

/* ── vistas ──────────────────────────────────────────────────── */
function trocarVista(v) {
  _vista = v === 'sep' ? 'sep' : 'drive';
  document.body.classList.toggle('vista-sep', _vista === 'sep');
  $('vt-drive').classList.toggle('on', _vista === 'drive');
  $('vt-sep').classList.toggle('on', _vista === 'sep');
  $('vt-drive').setAttribute('aria-selected', String(_vista === 'drive'));
  $('vt-sep').setAttribute('aria-selected', String(_vista === 'sep'));
  if (_vista === 'sep') { fecharLado?.(); renderSeparados(); if (!_sepOk || !_sep.length) carregarSeparacao(); }
  gravarURL();
  scrollTo({ top:0 });
}

/* ── lista ───────────────────────────────────────────────────── */
function sepCasa(r, q) {
  if (!q) return true;
  const txt = [r.produto_nome, r.codigo, normalizarCodigo(r.codigo), r.lote, r.armazem, r.pedido, r.origem_posicao, r.separado_por]
    .map(v => String(v || '').toUpperCase()).join(' ');
  return q.split(/\s+/).filter(Boolean).every(p => txt.includes(p));
}

function renderSeparados() {
  const box = $('sep-lista');
  if (!box) return;
  if (!_sepOk) {
    box.innerHTML = `<div class="vazio"><div class="vazio-t">A área de separação ainda não foi ativada</div>
      <div class="vazio-s">Rode o <b>sql/migracao-separacao.sql</b> no Supabase e atualize a página.</div></div>`;
    $('sep-resumo').textContent = '';
    return;
  }
  const q = _sepQ.trim().toUpperCase();
  const parados = _sep.filter(r => r._dias > SEP_DIAS_PARADO).length;
  const fat = _sep.filter(r => r._faturado).length;
  $('sep-filtro').innerHTML = [['todos', 'Todos', _sep.length], ['parados', `Parados há +${SEP_DIAS_PARADO} dias`, parados], ['faturado', 'Parece faturado', fat]]
    .map(([v, t, n]) => `<button class="${_sepFiltro === v ? 'on' : ''}" onclick="filtrarSep('${v}')">${t} <span class="sep-n">${num(n)}</span></button>`).join('');

  const lista = _sep.filter(r => sepCasa(r, q) &&
    (_sepFiltro === 'todos' || (_sepFiltro === 'parados' ? r._dias > SEP_DIAS_PARADO : r._faturado)));

  if (!lista.length) {
    box.innerHTML = `<div class="vazio"><div class="vazio-t">${_sep.length ? 'Nada com esse filtro' : 'Nenhum pedido separado'}</div>
      <div class="vazio-s">${_sep.length ? 'Troque o filtro ou a busca.' : 'Para separar, abra uma vaga no drive-in e toque em "Separação" no palete.'}</div></div>`;
    $('sep-resumo').textContent = '';
    return;
  }

  // Agrupa por pedido; "Sem pedido" por último.
  const grupos = new Map();
  for (const r of lista) { const p = pedidoDe(r); (grupos.get(p) || grupos.set(p, []).get(p)).push(r); }
  const ordem = [...grupos.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'pt-BR', { numeric:true }));
  const totais = un => { const t = {}; for (const r of un) { const u = unDe(r); t[u] = (t[u] || 0) + (Number(r.quantidade) || 0); } return Object.entries(t).map(([u, v]) => `${num(v)} ${esc(u)}`).join(' + '); };

  const nPed = ordem.filter(Boolean).length;
  $('sep-resumo').innerHTML = [`<b>${num(lista.length)}</b> item(ns)`,
    nPed ? `<b>${num(nPed)}</b> pedido(s)${grupos.has('') ? ' + itens sem pedido' : ''}` : 'sem pedido', totais(lista)].join(' · ');

  box.innerHTML = ordem.map(p => {
    const itens = grupos.get(p);
    return `<div class="sep-grupo">
      <div class="sep-gcab">
        <div><b>${p ? `Pedido ${esc(p)}` : 'Sem pedido'}</b><span>${num(itens.length)} item(ns) · ${totais(itens)}</span></div>
        ${itens.length > 1 ? `<button class="bt" onclick="expedirGrupoSep('${esc(p)}')">Expedir ${p ? 'o pedido' : 'todos'}</button>` : ''}
      </div>
      <div class="sep-itens">${itens.map(sepItemHTML).join('')}</div>
    </div>`;
  }).join('');
}

function sepItemHTML(r) {
  const parado = r._dias > SEP_DIAS_PARADO;
  return `<div class="sep-item${parado ? ' parado' : ''}${r._faturado ? ' faturado' : ''}" style="--c:${corDe(normalizarCodigo(r.codigo))}">
    <div class="sep-top">
      <div class="sep-nome">${esc(r.produto_nome || r.codigo)}</div>
      <div class="sep-qtd">${num(r.quantidade)}<small>${esc(unDe(r))}</small></div>
    </div>
    <div class="ficha-meta">${esc(normalizarCodigo(r.codigo))} ${seloFilial(r.filial || r.codigo)} · lote ${esc(r.lote || '—')} · arm. ${esc(r.armazem || '—')}</div>
    <div class="sep-info">Saiu de <b>${esc(r.origem_posicao || '—')}</b> · ${esc(r.separado_por || 'sem nome')} · ${r._dias ? `há ${r._dias} dia(s)` : 'hoje'}
      ${parado ? `<span class="sep-tag t-warn">parado há ${r._dias} dias</span>` : ''}
      ${r._faturado ? `<span class="sep-tag t-pos" title="A planilha do ERP importada depois da separação mostra o saldo deste lote caído">parece faturado</span>` : ''}</div>
    <div class="ficha-acoes">
      <button class="bt destaque" onclick="abrirSaidaSep(${Number(r.id)},'expedir')">Expedir</button>
      <button class="bt" onclick="abrirSaidaSep(${Number(r.id)},'retornar')">Retornar ao depósito</button>
    </div>
  </div>`;
}

function filtrarSep(v) { _sepFiltro = v; renderSeparados(); }

/* ── diálogo (separar / expedir / retornar) ──────────────────── */
function montarDlgSep() {
  if ($('dlg-sep')) return;
  const d = document.createElement('div');
  d.className = 'dlg'; d.id = 'dlg-sep'; d.hidden = true;
  d.innerHTML = `
  <div class="dlg-cx" role="dialog" aria-labelledby="sp-titulo">
    <div class="dlg-topo"><b id="sp-titulo">Separação</b>
      <button class="dlg-x" onclick="fecharDlgSep()" aria-label="Fechar">✕</button></div>
    <div class="dlg-corpo">
      <div class="ficha-nome" id="sp-nome"></div>
      <div class="ficha-meta" id="sp-meta" style="margin-bottom:13px"></div>
      <div class="ex-disp"><span id="sp-disp-rot">Nesta vaga</span><b id="sp-disp">—</b></div>
      <label class="cp"><span id="sp-qtd-rot">Quantidade</span>
        <input type="text" id="sp-qtd" inputmode="decimal" autocomplete="off"></label>
      <label class="cp" id="sp-pedido-cp"><span>Pedido ou carga <small style="font-weight:400;color:var(--text-3)">(opcional)</small></span>
        <input type="text" id="sp-pedido" autocomplete="off" list="sp-pedidos" placeholder="ex.: 012345"></label>
      <datalist id="sp-pedidos"></datalist>
      <div class="ex-restante" id="sp-restante"></div>
    </div>
    <div class="dlg-pe">
      <button class="bt" onclick="fecharDlgSep()">Cancelar</button>
      <button class="bt destaque" id="sp-ok" onclick="confirmarDlgSep()">Confirmar</button>
    </div>
  </div>`;
  document.body.appendChild(d);
  $('sp-qtd').addEventListener('input', atualizarDlgSep);
  d.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharDlgSep(); }
    if (e.key === 'Enter' && !$('sp-ok').disabled) { e.preventDefault(); confirmarDlgSep(); }
  });
}
function fecharDlgSep() { if ($('dlg-sep')) $('dlg-sep').hidden = true; _sepDlg = null; }

function abrirDlgSep(cfg) {
  montarDlgSep();
  _sepDlg = cfg;
  const r = cfg.item;
  $('sp-titulo').textContent = cfg.titulo;
  $('sp-nome').textContent = r.produto_nome || r.codigo;
  $('sp-meta').innerHTML = `${esc(normalizarCodigo(r.codigo))} ${seloFilial(r.filial || r.codigo)} · lote ${esc(r.lote || '—')} · arm. ${esc(r.armazem || '—')}` +
    (cfg.modo === 'separar' ? ` · ${esc(cfg.pos)}` : r.pedido ? ` · pedido ${esc(r.pedido)}` : '');
  $('sp-disp-rot').textContent = cfg.modo === 'separar' ? 'Nesta vaga' : 'Na separação';
  $('sp-disp').textContent = `${num(cfg.max)} ${unDe(r)}`;
  $('sp-qtd-rot').textContent = cfg.qtdRot;
  $('sp-qtd').value = cfg.max;
  $('sp-pedido-cp').hidden = cfg.modo !== 'separar';
  $('sp-pedido').value = '';
  $('sp-pedidos').innerHTML = [...new Set(_sep.map(pedidoDe).filter(Boolean))].sort().map(p => `<option value="${esc(p)}">`).join('');
  $('sp-ok').textContent = cfg.botao;
  atualizarDlgSep();
  $('dlg-sep').hidden = false;
  setTimeout(() => { $('sp-qtd').focus(); $('sp-qtd').select(); }, 50);
}

function atualizarDlgSep() {
  if (!_sepDlg) return;
  const { max, item:r, modo } = _sepDlg;
  const q = numBR($('sp-qtd').value), un = unDe(r), el = $('sp-restante');
  let ok = false;
  if (!Number.isFinite(q) || q <= 0) { el.textContent = 'Informe a quantidade.'; el.className = 'ex-restante alerta'; }
  else if (q > max + 0.0001) { el.textContent = `Só há ${num(max)} ${un}.`; el.className = 'ex-restante alerta'; }
  else {
    ok = true;
    const resto = Math.round((max - q) * 1000) / 1000;
    const onde = modo === 'separar' ? _sepDlg.pos : 'na separação';
    el.textContent = resto > 0
      ? `Ficam ${num(resto)} ${un} ${modo === 'separar' ? 'em ' : ''}${onde}.`
      : modo === 'separar' ? `Vai tudo — ${onde} fica livre.` : 'Sai tudo da separação.';
    el.className = 'ex-restante ' + (resto > 0 ? 'ok' : 'zera');
  }
  $('sp-ok').disabled = !ok;
}

async function confirmarDlgSep() {
  if (!_sepDlg) return;
  const cfg = _sepDlg;
  const q = Math.min(cfg.max, numBR($('sp-qtd').value));
  if (!Number.isFinite(q) || q <= 0) return;
  $('sp-ok').disabled = true;
  try {
    if (cfg.modo === 'separar')       await separar(cfg.item, cfg.pos, q, $('sp-pedido').value.trim().toUpperCase());
    else if (cfg.modo === 'expedir')  await expedirSep([{ r:cfg.item, q }]);
    else if (cfg.modo === 'retornar') { fecharDlgSep(); iniciarRetorno(cfg.item, q); return; }
    fecharDlgSep();
  } catch (e) {
    toast('Não deu: ' + e.message, 'err', 6000);
    $('sp-ok').disabled = false;
  }
}

/* ── separar (vem do painel da vaga) ─────────────────────────── */
function abrirSeparar(pos, id, tab) {
  if (!_sepOk) { toast('Rode o sql/migracao-separacao.sql no Supabase para ativar a separação.', 'err', 6000); return; }
  const r = (_ocupacao[pos] || []).find(x => String(x.id) === String(id) && (!tab || x._tab === tab));
  if (!r) return;
  abrirDlgSep({ modo:'separar', item:r, pos, max:Number(r.quantidade) || 0,
    titulo:'Mandar para separação', qtdRot:'Quanto vai para a separação', botao:'Mandar para separação' });
}

async function separar(r, pos, q, pedido) {
  const disp = Number(r.quantidade) || 0;
  const resto = Math.round((disp - q) * 1000) / 1000;
  const codigo = normalizarCodigo(r.codigo), arm = normalizarArmazem(r.armazem);

  // O saldo do ERP agora, para saber depois se faturou.
  let antes = null, foto = null;
  try {
    const { data } = await sb.from('estoque_ref').select('saldo, importado_em')
      .eq('codigo', codigo).eq('lote', String(r.lote || '').trim().toUpperCase()).eq('armazem', arm);
    if (data?.length) {
      antes = data.reduce((a, s) => a + (Number(s.saldo) || 0), 0);
      foto = data.map(s => s.importado_em).filter(Boolean).sort().pop() || null;
    }
  } catch { /* sem planilha */ }

  const novo = await inserirResiliente('separacao', {
    codigo, produto_nome:r.produto_nome || produtoPorCodigo(codigo)?.nome || codigo,
    lote:r.lote || null, armazem:arm || null, filial:r.filial || codigoFilialDoProduto(codigo),
    quantidade:q, pedido:pedido || null, origem_posicao:pos,
    saldo_erp_antes:antes, foto_erp_em:foto,
    status:'separado', separado_por:QUEM, separado_em:new Date().toISOString(),
  }, { retornar:true });

  try {
    await atualizarResiliente(r._tab || 'historico', resto > 0
      ? { quantidade:resto, updated_at:new Date().toISOString(), feito_por:QUEM }
      : { ocupacao_ativa:false, updated_at:new Date().toISOString(), feito_por:QUEM },
      x => x.eq('id', r.id));
  } catch (e) {
    // A vaga não baixou: desfaz a separação para não contar duas vezes.
    const id = novo?.[0]?.id;
    if (id) await sb.from('separacao').delete().eq('id', id);
    throw e;
  }

  await registrarAlteracao({
    acao:'separou', posicao:pos, codigo, produto_nome:r.produto_nome, lote:r.lote, armazem:arm,
    qtd_antes:disp, qtd_depois:resto, tabela_ref:'separacao', ref_id:novo?.[0]?.id,
    obs:`${num(q)} ${unDe(r)} para a separação${pedido ? ` · pedido ${pedido}` : ''}`,
  });
  toast(`${num(q)} ${unDe(r)} na separação${pedido ? ` · pedido ${pedido}` : ''}.`, 'ok', 4500);
  await carregar(true);           // recarrega o mapa e a separação
}

/* ── expedir ─────────────────────────────────────────────────── */
function abrirSaidaSep(id, modo) {
  const r = _sep.find(x => Number(x.id) === Number(id));
  if (!r) return;
  abrirDlgSep(modo === 'expedir'
    ? { modo, item:r, max:Number(r.quantidade) || 0, titulo:'Expedir da separação', qtdRot:'Quanto saiu', botao:'Expedir' }
    : { modo, item:r, max:Number(r.quantidade) || 0, titulo:'Retornar ao depósito', qtdRot:'Quanto volta para o drive-in', botao:'Escolher a vaga' });
}

function expedirGrupoSep(pedido) {
  const itens = _sep.filter(r => pedidoDe(r) === pedido && sepCasa(r, _sepQ.trim().toUpperCase()) &&
    (_sepFiltro === 'todos' || (_sepFiltro === 'parados' ? r._dias > SEP_DIAS_PARADO : r._faturado)));
  if (!itens.length) return;
  if (!confirm(`Expedir ${itens.length} item(ns) ${pedido ? `do pedido ${pedido}` : 'sem pedido'}?\n\n` +
    itens.map(r => `· ${r.produto_nome || r.codigo} · lote ${r.lote || '—'} · ${num(r.quantidade)} ${unDe(r)}`).join('\n') +
    '\n\nSaem do mapa e do Saldo mapeado.')) return;
  expedirSep(itens.map(r => ({ r, q:Number(r.quantidade) || 0 }))).catch(e => toast('Não deu para expedir: ' + e.message, 'err', 6000));
}

async function expedirSep(lista) {
  const agora = new Date().toISOString();
  for (const { r, q } of lista) {
    const disp = Number(r.quantidade) || 0;
    const resto = Math.round((disp - q) * 1000) / 1000;
    await atualizarResiliente('separacao', resto > 0
      ? { quantidade:resto, updated_at:agora }
      : { status:'expedido', finalizado_por:QUEM, finalizado_em:agora, updated_at:agora },
      x => x.eq('id', r.id));
    await registrarAlteracao({
      acao:'expediu', posicao:SEP_LUGAR, codigo:r.codigo, produto_nome:r.produto_nome, lote:r.lote, armazem:r.armazem,
      qtd_antes:disp, qtd_depois:resto, tabela_ref:'separacao', ref_id:r.id,
      obs:`saiu ${num(q)} ${unDe(r)} da separação${r.pedido ? ` · pedido ${r.pedido}` : ''}`,
    });
  }
  toast(lista.length > 1 ? `${lista.length} itens expedidos.` : `${num(lista[0].q)} ${unDe(lista[0].r)} expedido.`, 'ok', 4500);
  await carregarSeparacao();
}

/* ── retornar: escolhe a vaga no mapa, como no "Mover" ───────── */
function iniciarRetorno(r, q) {
  _sel = { modo:'retornar', item:r, qtd:q, de:SEP_LUGAR, sugestao:r.origem_posicao || '' };
  const di = String(r.origem_posicao || '').split('-')[0];
  const pav = PAV_DO_DI_MAPA[di];
  if (pav && pav !== _pav) { _pav = pav; $('sel-pav').value = pav; }
  if (pav && _di && _di !== di) _di = di;
  trocarVista('drive');
  popularDI(); construir();
  renderSelbar(); pintar();
  if (_sel.sugestao) document.querySelector(`.cel[data-pos="${CSS.escape(_sel.sugestao)}"]`)?.scrollIntoView?.({ block:'center', behavior:'smooth' });
}

function selbarRetornoHTML() {
  const r = _sel.item;
  return `<div class="txt"><b>Retornando ${esc(nomeCurto(r.produto_nome || r.codigo))}</b> · lote ${esc(r.lote || '—')} · ${num(_sel.qtd)} ${esc(unDe(r))}
      <small>Da separação para o drive-in. Toque na vaga de destino.</small></div>
    ${_sel.sugestao ? `<button class="bt destaque" onclick="retornarPara('${esc(_sel.sugestao)}')">Voltar para ${esc(_sel.sugestao)}</button>` : ''}
    <button class="bt" onclick="cancelarMover()">Cancelar</button>`;
}

async function retornarPara(dest) {
  if (!_sel || _sel.modo !== 'retornar') return;
  const { item:r, qtd:q } = _sel;
  const ja = _ocupacao[dest] || [];
  if (!confirm(`Retornar ${r.produto_nome || r.codigo} · lote ${r.lote || '—'} (${num(q)} ${unDe(r)})\nda separação para ${dest}?` +
               (ja.length ? `\n\n${dest} já tem ${ja.length} item(ns); o palete fica junto.` : ''))) return;
  const disp = Number(r.quantidade) || 0;
  const resto = Math.round((disp - q) * 1000) / 1000;
  const agora = new Date().toISOString();
  try {
    await inserirResiliente('historico', {
      codigo:normalizarCodigo(r.codigo), produto_nome:r.produto_nome, lote:r.lote, armazem:r.armazem,
      quantidade:q, filial:r.filial || codigoFilialDoProduto(r.codigo),
      posicao:dest, ocupacao_ativa:true, confirmado:true,
      origem:'retorno', feito_por:QUEM, created_at:agora,
    });
    await atualizarResiliente('separacao', resto > 0
      ? { quantidade:resto, updated_at:agora }
      : { status:'retornado', destino_posicao:dest, finalizado_por:QUEM, finalizado_em:agora, updated_at:agora },
      x => x.eq('id', r.id));
    await registrarAlteracao({
      acao:'retornou', posicao:dest, codigo:r.codigo, produto_nome:r.produto_nome, lote:r.lote, armazem:r.armazem,
      qtd_antes:0, qtd_depois:q, tabela_ref:'separacao', ref_id:r.id,
      obs:`${num(q)} ${unDe(r)} da separação para ${dest}${r.pedido ? ` · pedido ${r.pedido}` : ''}`,
    });
    toast(`Voltou para ${dest}.`, 'ok', 4500);
    _sel = null; renderSelbar();
    await carregar(true);
    abrirVaga(dest);
  } catch (e) { toast('Não deu para retornar: ' + e.message, 'err', 6000); }
}

/* ── estilo ──────────────────────────────────────────────────── */
(function () {
  const st = document.createElement('style');
  st.textContent = `
  .vistas { display:flex; gap:4px; padding:3px; margin-bottom:10px; border-radius:10px; background:var(--surface-2); border:1px solid var(--line); max-width:420px; }
  .vistas button { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:36px; border:0; border-radius:7px;
    background:transparent; color:var(--text-2); font:inherit; font-size:.875rem; font-weight:600; cursor:pointer; }
  .vistas button.on { background:var(--surface); color:var(--text); box-shadow:0 0 0 1px var(--line-2); }
  .vt-n { font-family:var(--mono); font-size:.6875rem; padding:1px 6px; border-radius:100px; background:var(--surface-3); color:var(--text-2); }
  .vt-n:empty { display:none; }
  .vt-n.alerta { background:var(--warn-sf); color:var(--warn); }
  #separados { display:none; }
  body.vista-sep #separados { display:block; }
  body.vista-sep .busca, body.vista-sep #di-tabs, body.vista-sep #busca-filtro, body.vista-sep #busca-cnt,
  body.vista-sep .stats, body.vista-sep #mapa, body.vista-sep .legenda, body.vista-sep #lista,
  body.vista-sep #sel-di, body.vista-sep #sel-pav { display:none !important; }
  .sep-topo { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
  .sep-topo .sep-busca { flex:1 1 260px; position:relative; }
  .sep-topo .sep-busca input { width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-sm); color:var(--text); font:inherit; font-size:.9375rem; }
  .sep-topo .sep-busca input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-sf); }
  #sep-filtro { flex:0 1 auto; }
  #sep-filtro button { white-space:nowrap; padding:7px 10px; }
  .sep-n { font-family:var(--mono); font-size:.6875rem; color:var(--text-3); margin-left:3px; }
  .sep-resumo { font-size:.8125rem; color:var(--text-2); margin:0 0 12px; }
  .sep-grupo { background:var(--surface); border:1px solid var(--line); border-radius:var(--r); padding:12px; margin-bottom:14px; }
  .sep-gcab { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .sep-gcab > div { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
  .sep-gcab b { font-size:.9375rem; }
  .sep-gcab span { font-size:.75rem; color:var(--text-3); font-family:var(--mono); }
  .sep-item { border:1px solid var(--line); border-left:3px solid var(--c, var(--line-2)); border-radius:var(--r-sm); padding:10px 12px; background:var(--surface-2); }
  .sep-itens { display:grid; gap:8px; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); }
  .sep-item.parado { border-color:var(--warn); border-left-color:var(--warn); }
  .sep-item.faturado { box-shadow:0 0 0 1px var(--pos) inset; }
  .sep-top { display:flex; align-items:baseline; gap:10px; }
  .sep-nome { font-weight:600; font-size:.875rem; flex:1; min-width:0; }
  .sep-qtd { font-family:var(--mono); font-weight:600; font-size:1rem; white-space:nowrap; }
  .sep-qtd small { font-size:.6875rem; font-weight:400; color:var(--text-3); margin-left:3px; }
  .sep-info { font-size:.75rem; color:var(--text-2); margin-top:4px; display:flex; flex-wrap:wrap; gap:4px 8px; align-items:center; }
  .sep-tag { font-size:.6875rem; font-weight:600; padding:1px 7px; border-radius:100px; }
  .sep-tag.t-warn { background:var(--warn-sf); color:var(--warn); }
  .sep-tag.t-pos { background:var(--pos-sf); color:var(--pos); }
  @media (max-width:760px) {
    .vistas { max-width:none; margin:0 0 8px; }
    .vistas button { min-height:40px; }
    .sep-topo .sep-busca input { font-size:16px; min-height:46px; }
    #sep-filtro { width:100%; overflow-x:auto; }
    .sep-gcab { flex-wrap:wrap; }
    .sep-itens { grid-template-columns:minmax(0,1fr); }
    .selbar .txt { flex:1 1 100%; }
    .selbar .bt { flex:1; }
    body.movendo .toast { bottom:calc(170px + env(safe-area-inset-bottom)); }
    .sep-item .ficha-acoes .bt { min-height:44px; }
  }`;
  document.head.appendChild(st);
})();
