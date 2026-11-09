/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · SALDO MAPEADO × SISTEMA  (aba "Saldo mapeado" do painel)

   De um lado o que está nas vagas do drive-in; do outro o saldo do
   ERP. Antes a tela cruzava código+lote+armazém às cegas, e isso
   gerava divergência que não existia:
     · armazém digitado errado virava DUAS linhas (sobra num, falta
       no outro) — agora as duas são juntadas em "Armazém trocado";
     · armazém que não é físico e lote zerado entravam na conta;
     · L, KG e DS eram somados no mesmo número;
     · código sem o zero à esquerda não casava com o do ERP;
     · item sem filial sumia quando se filtrava por filial.

   Os dois lados vêm só desta aba: o Mapeado é o que está ocupando
   vaga no mapa (historico com ocupacao_ativa) e o Sistema é a
   planilha importada aqui. Nada vem da contagem.

   Depende do painel (carregado antes dele): _ocupacao, _naoConf,
   _naoConfFora, _ciclo, carregarMapa, fatiar, barraPag,
   kpi, irPara, abrirVaga, setEscopoMapa, imprimirTabela...
   ═══════════════════════════════════════════════════════════════ */

/* Rótulos das ações da separação na trilha de alterações. */
if (typeof ACOES === 'object') Object.assign(ACOES, {
  separou:  { rot:'Mandou para a separação', cor:'warn' },
  retornou: { rot:'Voltou da separação',     cor:'pos'  },
});

/* Armazéns que ficam no drive-in e por isso têm de estar no mapa.
   48 (descarte) e CE (estoque de clientes) existem, mas não são
   mapeados: o saldo deles não entra na comparação. */
const ARM_MAPEADOS = ['42', '49', '85', '91', '94', '98', 'D2', 'D4', 'D5', 'D6', 'D7', 'D8'];
const armMapeado = a => ARM_MAPEADOS.includes(normalizarArmazem(a));

/* ── planilha de referência ── */
let _refInfo        = null;       // { linhas, porArm:{arm:{quando,quem,linhas}}, de, ate }
let _registrosRef   = null;       // planilha lida, esperando "Usar esta planilha"
let _refLinhas      = null;
let _referencia     = null;       // marca que a fonte já foi carregada

/* ── tela ── */
let _sVisao     = 'lote';         // lote | produto
let _situacao   = 'todas';
let _ordem      = 'gravidade';
let _ordemAsc   = false;
let _sArmFiltro = '';             // armazém clicado no card
let _abertas    = new Set();
let _saldoMapa  = [];             // o que está na tabela agora (para CSV/impressão)
let _sCalc      = null;           // último cálculo completo
let _sReg       = [];             // linhas renderizadas, por índice (onclick sem string no HTML)
let _movFoto    = null;           // Map cod|lote → nº de mexidas no mapa depois da planilha

/* Quais armazéns físicos ficam FORA da conta — por navegador.
   Padrão: todos dentro. */
const LS_ARM_FORA = 'saldo.armazensFora';
let _armFora = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(LS_ARM_FORA) || '[]')); }
  catch { return new Set(); }
})();
function gravarArmFora() {
  try { localStorage.setItem(LS_ARM_FORA, JSON.stringify([..._armFora])); } catch { /* sem storage: só não lembra */ }
}

const SITUACOES = {
  'sem-saldo':   { rot:'Sem saldo no sistema',      cor:'neg',  peso:0,
                   expl:'Está no mapa, mas o produto não tem saldo nenhum no sistema (nesta filial).' },
  'lote':        { rot:'Lote não existe',           cor:'neg',  peso:1,
                   expl:'O produto tem saldo, mas não com este lote. Quase sempre é lote digitado errado.' },
  'produto':     { rot:'Produto trocado',           cor:'neg',  peso:1,
                   expl:'No mapa a vaga tem um produto; no sistema, o mesmo lote, no mesmo armazém e com a mesma quantidade, é de outro produto. O número do lote se repete entre produtos — escolheram o produto errado na vaga.' },
  'codigo':      { rot:'Código de outra filial',    cor:'alt',  peso:2,
                   expl:'O mesmo lote está no mapa com o código de uma filial e no sistema com o código da outra (mesmo produto, Simbiose × Bioma).' },
  'armazem':     { rot:'Armazém trocado',           cor:'alt',  peso:2,
                   expl:'O mesmo produto+lote está no mapa com um armazém e no sistema com outro.' },
  'sobra':       { rot:'Sobra no mapa',             cor:'warn', peso:3,
                   expl:'O mapa tem mais do que o sistema.' },
  'falta':       { rot:'Falta no mapa',             cor:'warn', peso:4,
                   expl:'O mapa tem menos do que o sistema.' },
  'nao-mapeado': { rot:'Fora do mapa',              cor:'info', peso:5,
                   expl:'Tem saldo no sistema e nenhuma vaga no mapa.' },
  'ok':          { rot:'Confere',                   cor:'pos',  peso:6,
                   expl:'Mapa e sistema batem (tolerância de 0,02%).' },
};
const ORDEM_SIT = Object.keys(SITUACOES);
const nomeCurtoSaldo = t => String(t || '').replace(/\s+/g, ' ').trim();
const UNIDADES  = [['L', 'Litros'], ['KG', 'Quilos'], ['DS', 'Doses']];

/* ═══════════════════════════════════════════════════════════════
   CHAVES E FORMATOS
   ═══════════════════════════════════════════════════════════════ */
const sCod  = c => normalizarCodigo(c);
const sKc   = (cod, lote) => `${chave(sCod(cod))}|${chave(lote)}`;            // produto+lote
const sKl   = (cod, lote, arm) => `${sKc(cod, lote)}|${normalizarArmazem(arm)}`;  // + armazém
const sFil  = v => resolverFilial(v)?.slug || null;
const sPassaFilial = slug => { const a = $('filtro-filial')?.value; return !a || slug === a; };
const sQtd  = (n, un) => `${num(arred(n))}${un ? ' ' + un : ''}`;
const sPl   = n => n == null ? '—' : (Math.abs(n) < 0.05 && n !== 0 ? (n > 0 ? '<0,1' : '>-0,1') : num1(n));
function arred(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

/* Lote "parecido": mesmo texto sem traço/espaço, um contido no outro,
   ou até 2 letras de diferença. É o que pega a digitação errada. */
function lotesParecidos(a, b) {
  const x = String(a || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const y = String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  if (Math.abs(x.length - y.length) > 2 || Math.min(x.length, y.length) < 5) return false;
  const d = Array.from({ length:x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (x[i-1] === y[j-1] ? 0 : 1));
  return d[x.length][y.length] <= 2;
}

/* ═══════════════════════════════════════════════════════════════
   PLANILHA DE REFERÊNCIA
   A mesma exportação do ERP, guardada à parte só para comparar com
   o mapa. Nunca usa o saldo da contagem (saldo_sistema).

   Duas formas de importar:
     · Geral — troca a foto inteira da filial que veio na planilha;
     · Um armazém (D7, D5...) — entram só as linhas daquele armazém
       e só a foto dele é trocada. Os outros continuam como estavam.
   ═══════════════════════════════════════════════════════════════ */
let _importAlvo = '';             // armazém da planilha lida ('' = geral)
let _sOcup      = {};             // vaga → itens, só o que está no mapa

function linhasDeReferencia() { return _refLinhas || []; }
const armImport = () => $('s-imp-arm')?.value || '';

function atualizarTextoImport() {
  const a = armImport();
  if ($('s-drop-tit')) $('s-drop-tit').textContent = a
    ? `Solte a planilha para atualizar só o armazém ${a}`
    : 'Solte a planilha para atualizar todos os armazéns';
  if ($('s-drop-sub')) $('s-drop-sub').textContent = a
    ? `Só as linhas do ${a}${nomeArmazem(a) ? ' (' + nomeArmazem(a) + ')' : ''} entram. Os outros armazéns continuam com a foto que já têm.`
    : 'Troca a foto inteira da filial que vier na planilha. Não abre ciclo nem mexe na contagem.';
  _registrosRef = null;
  if ($('s-import-status')) $('s-import-status').innerHTML = '';
}

function configurarDropRef() {
  const d = $('s-drop');
  if (!d) return;
  ['dragenter','dragover'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove('over'); }));
  d.addEventListener('drop', e => { const f = e.dataTransfer.files?.[0]; if (f) lerPlanilhaRef(f); });
}

function aoEscolherPlanilhaRef(ev) {
  const f = ev.target.files?.[0];
  if (f) lerPlanilhaRef(f);
  ev.target.value = '';
}

async function lerPlanilhaRef(file) {
  const status = $('s-import-status');
  status.innerHTML = '<div class="skeleton">lendo a planilha…</div>';
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates:true });
    // A planilha do ERP tem várias abas (SB5, SB8…): usa a SB8_SALDOS_LOTES,
    // ou a primeira que tenha B8_PRODUTO no cabeçalho, ou a primeira.
    const cabDe = n => { const ws = wb.Sheets[n], r = ws?.['!ref'] && XLSX.utils.decode_range(ws['!ref']);
      if (!r) return []; r.e.r = r.s.r;   // só a primeira linha
      return (XLSX.utils.sheet_to_json(ws, { header:1, range:r })[0] || []).map(c => String(c).trim().toUpperCase()); };
    const aba = wb.SheetNames.find(n => n.trim().toUpperCase() === 'SB8_SALDOS_LOTES')
             || wb.SheetNames.find(n => { const c = cabDe(n); return ['B8_PRODUTO', 'B8_LOTECTL', 'B8_SALDO', 'B8_LOCAL'].every(x => c.includes(x)); })
             || wb.SheetNames[0];
    const brutas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { raw:true, defval:'' });
    if (!brutas.length) throw new Error('a planilha está vazia');

    const linhas = brutas.map(bruta => {
      const o = {};
      for (const [k, v] of Object.entries(bruta)) {
        const destino = COL_MAP[String(k).trim().toLowerCase()];
        if (destino) o[destino] = typeof v === 'string' ? v.trim() : v;
      }
      return o;
    });
    const faltando = ['codigo','lote','saldo','armazem'].filter(c => linhas.every(l => l[c] === undefined));
    if (faltando.length) throw new Error(`colunas não encontradas: ${faltando.join(', ')}`);

    const temPl = linhas.some(l => l.paletes !== undefined), temCx = linhas.some(l => l.caixas !== undefined);
    const todas = linhas.filter(l => l.codigo).map(l => ({
      codigo:    normalizarCodigo(l.codigo),
      descricao: String(l.descricao || '').trim(),
      lote:      String(l.lote || '').trim().toUpperCase(),
      armazem:   normalizarArmazem(l.armazem),
      unidade:   String(l.unidade || '').trim(),
      tipo:      String(l.tipo || '').trim().toUpperCase() || null,
      saldo:     paraNumero(l.saldo) ?? 0,
      empenho:   paraNumero(l.empenho),
      filial:    String(l.filial || '').trim(),
      // Para a identificação do palete (coluna nova: migracao-identificacao.sql).
      dt_fabricacao: paraData(l.dt_fabricacao),
      dt_validade:   paraData(l.dt_validade),
      // Tela Saldo (migracao-saldo-historico.sql). Só vai se a planilha tiver a coluna.
      ...(temPl ? { paletes:paraNumero(l.paletes) } : {}),
      ...(temCx ? { caixas:paraNumero(l.caixas) } : {}),
      importado_por: GESTOR || 'painel',
    }));
    if (!todas.length) throw new Error('nenhuma linha com código');

    _importAlvo = armImport();
    _registrosRef = _importAlvo ? todas.filter(r => r.armazem === _importAlvo) : todas;
    if (!_registrosRef.length) {
      const tem = [...new Set(todas.map(r => r.armazem).filter(Boolean))].sort();
      throw new Error(`a planilha não tem nenhuma linha do armazém ${_importAlvo}. Armazéns nela: ${tem.join(', ') || '—'}`);
    }

    const filiais = [...new Set(_registrosRef.map(r => filialCurta(r.filial)).filter(Boolean))];
    const zeradas = _registrosRef.filter(r => !r.saldo).length;
    const antigas = _importAlvo ? (_refLinhas || []).filter(r => normalizarArmazem(r.armazem) === _importAlvo).length : 0;
    const oque = _importAlvo
      ? `<b>Só o armazém ${esc(_importAlvo)}</b>${num(_registrosRef.length)} linha(s) de ${num(todas.length)} na planilha.
         Apaga todo o saldo antigo do ${esc(_importAlvo)}${antigas ? ` (${num(antigas)} linha(s), de qualquer filial)` : ''} e grava este no lugar; os outros armazéns não mudam.`
      : `<b>Geral — todos os armazéns</b>${num(_registrosRef.length)} linha(s).
         Troca a foto inteira ${filiais.length > 1 ? 'dessas filiais' : 'dessa filial'}, inclusive armazéns importados um a um antes.`;
    // As datas (fabricação e validade) só são gravadas se o banco já tem
    // as colunas. Sem elas o import passa calado e a identificação do
    // palete fica sem data — então avisa ANTES de gravar.
    const comDatas = _registrosRef.some(r => r.dt_fabricacao || r.dt_validade);
    let semColunaData = false;
    if (comDatas) {
      try { const { error } = await sb.from('estoque_ref').select('dt_fabricacao, dt_validade').limit(1); semColunaData = !!error; }
      catch { semColunaData = true; }
    }
    const avisoDatas = semColunaData
      ? `<div class="aviso a-warn" style="margin-top:10px"><span class="aviso-ico">!</span><div><b>As datas não vão ser gravadas</b>
           O banco ainda não tem as colunas de fabricação e validade. Rode o <b>sql/migracao-identificacao.sql</b> no Supabase e solte a planilha de novo — senão a identificação do palete sai sem data.</div></div>`
      : comDatas ? '' : `<div class="aviso a-info" style="margin-top:10px"><span class="aviso-ico">i</span><div>A planilha não tem as colunas “data de fabricação” e “data de validade” — a identificação do palete vai sair sem data.</div></div>`;
    status.innerHTML = `${avisoDatas}
      <div class="aviso ${_importAlvo ? 'a-info' : 'a-warn'}" style="margin-top:12px">
        <span class="aviso-ico">▤</span>
        <div><b>${esc(file.name)}</b>
          ${oque} Filial ${esc(filiais.join(', ') || '—')}${zeradas ? ` · ${num(zeradas)} com saldo zero (ficam fora da conta)` : ''}.
          <div style="margin-top:10px">
            <button class="btn btn-primary btn-sm" id="s-btn-import" onclick="importarRef()">
              <span class="spin" id="s-spin-import"></span>${_importAlvo ? `Atualizar o ${esc(_importAlvo)}` : 'Atualizar todos os armazéns'}</button>
            <button class="btn btn-ghost btn-sm" onclick="$('s-import-status').innerHTML=''">Cancelar</button>
          </div>
        </div>
      </div>`;
  } catch (e) {
    _registrosRef = null;
    status.innerHTML = `<div class="aviso a-warn"><span class="aviso-ico">!</span>
      <div><b>Não deu para ler</b>${esc(e.message)}</div></div>`;
  }
}

async function importarRef() {
  if (!_registrosRef?.length) return;
  // Trocou o seletor depois de ler a planilha: a prévia não vale mais.
  if (_importAlvo !== armImport()) { toast('Você trocou o armazém depois de ler a planilha. Solte o arquivo de novo.', 'warn', 5000); return; }
  busy('s-btn-import', 's-spin-import', true);
  try {
    const filiais = [...new Set(_registrosRef.map(r => r.filial).filter(Boolean))];
    // Um armazém: apaga TODO o saldo antigo dele, de qualquer filial —
    // a planilha nova passa a ser a única foto do D7.
    // Geral: apaga a filial inteira que veio na planilha.
    let apagar = sb.from('estoque_ref').delete().not('id', 'is', null);
    if (_importAlvo)          apagar = apagar.eq('armazem', _importAlvo);
    else if (filiais.length)  apagar = apagar.in('filial', filiais);
    const { error:eD } = await apagar;
    if (eD) throw eD;

    const agora = new Date().toISOString();
    const linhas = _registrosRef.map(r => ({ ...r, importado_em:agora }));
    for (let i = 0; i < linhas.length; i += 500) {
      await inserirResiliente('estoque_ref', linhas.slice(i, i + 500));
    }
    toast(_importAlvo ? `Armazém ${_importAlvo} atualizado: ${num(linhas.length)} linha(s).`
                      : `Todos os armazéns atualizados: ${num(linhas.length)} linha(s).`, 'ok', 4500);
    _registrosRef = null;
    $('s-import-status').innerHTML = avisoColunasIgnoradas('estoque_ref');
    // Histórico da tela Saldo. Sem a migração, a função não existe — segue.
    try { await sb.rpc('registrar_saldo_diario'); } catch { /* sem histórico */ }
    if (typeof carregarSaldoErp === 'function') {
      if (!$('s-import-status').innerHTML.trim()) fecharModal('modal-sa-import');
      await carregarSaldoErp(true);
    } else await carregarSaldoMapa(true);
  } catch (e) {
    erro('Falha ao importar', e);
  } finally {
    busy('s-btn-import', 's-spin-import', false);
  }
}

async function carregarRef() {
  try {
    // select('*'): tipo e empenho só existem depois da migração; pedir
    // a coluna pelo nome derrubava a leitura inteira antes dela.
    const linhas = await buscarTudo(() => sb.from('estoque_ref').select('*'));
    const porArm = {};
    for (const l of linhas) {
      const a = normalizarArmazem(l.armazem) || '—';
      const p = porArm[a] ||= { quando:l.importado_em, quem:l.importado_por, linhas:0 };
      p.linhas++;
      if (l.importado_em && (!p.quando || l.importado_em < p.quando)) { p.quando = l.importado_em; p.quem = l.importado_por; }
    }
    const datas = Object.values(porArm).map(p => p.quando).filter(Boolean).sort();
    _refInfo = linhas.length ? { linhas:linhas.length, porArm, de:datas[0], ate:datas[datas.length - 1] } : null;
    return linhas;
  } catch (e) {
    _refInfo = null;
    return [];
  }
}

/* Só o que está ocupando vaga no mapa. Lançamento de contagem ainda
   pendente NÃO entra: o saldo mapeado é o mapa, não a contagem. */
async function carregarOcupacaoSaldo() {
  const hist = await buscarTudo(() => sb.from('historico')
    .select('id, posicao, codigo, produto_nome, lote, armazem, quantidade, origem, ciclo_id, created_at, filial')
    .eq('ocupacao_ativa', true).not('posicao', 'is', null));
  const m = {};
  comFilial(hist);
  for (const r of hist) (m[r.posicao] ||= []).push({ ...r, _tab:'historico' });
  // Pedidos separados (mapa.html → aba Pedidos separados): saíram do
  // drive-in mas continuam no armazém do ERP até faturar — contam como
  // mapeados, num lugar só chamado SEPARAÇÃO.
  try {
    const { data, error } = await sb.from('separacao')
      .select('id, codigo, produto_nome, lote, armazem, quantidade, filial, pedido, separado_em').eq('status', 'separado');
    if (!error && data?.length) {
      comFilial(data);
      m[SALDO_SEP] = data.map(r => ({ ...r, posicao:SALDO_SEP, origem:r.pedido ? `pedido ${r.pedido}` : 'separado', created_at:r.separado_em, _tab:'separacao', sep:true }));
    }
  } catch { /* tabela ainda não criada */ }
  _sOcup = m;
}
const SALDO_SEP = 'SEPARAÇÃO';

/* Mexidas no mapa por produto+lote, com a data de cada uma. Cada
   lote compara com a data da SUA planilha — com importação por
   armazém, o D7 pode ser de hoje e o 42 de semana passada. */
async function carregarMovimentos() {
  const desde = _refInfo?.de;
  if (!desde) { _movFoto = null; return; }
  try {
    const linhas = await buscarTudo(() => sb.from('alteracoes')
      .select('codigo, lote, acao, created_at').gte('created_at', desde));
    const m = new Map();
    for (const a of linhas) {
      if (!a.codigo || a.acao === 'validou') continue;
      const k = sKc(a.codigo, a.lote);
      (m.get(k) || m.set(k, []).get(k)).push(a.created_at);
    }
    _movFoto = m;
  } catch { _movFoto = null; }
}
function mexidasDepois(kc, desde) {
  const ts = (_movFoto?.get(kc) || []).filter(t => !desde || t > desde);
  return ts.length ? { n:ts.length, ultimo:ts.sort().pop() } : null;
}

/* ═══════════════════════════════════════════════════════════════
   CARGA
   ═══════════════════════════════════════════════════════════════ */
async function carregarSaldoMapa(forcar = false) {
  $('s-tabela').innerHTML = `<div class="skeleton">carregando…</div>`;
  try {
    if (forcar) cacheInvalidar('mapa');
    // O mapa da aba Mapa continua sendo carregado: dele vêm as vagas
    // não confirmadas e é para ele que "Ver no mapa" leva.
    await Promise.all([
      (forcar || !Object.keys(_ocupacao).length) ? carregarMapa() : null,
      carregarOcupacaoSaldo(),
      (forcar || _referencia === null) ? carregarRef().then(r => { _refLinhas = r; }) : null,
    ]);
    _referencia = true;
    await carregarMovimentos();
    renderSaldo();
  } catch (e) {
    $('s-tabela').innerHTML = `<div class="empty"><div class="empty-tit">Não foi possível carregar</div><div class="empty-sub">${esc(e.message)}</div></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   CÁLCULO
   Monta uma linha por produto + lote + armazém, depois junta as
   órfãs que são a mesma mercadoria com armazém diferente.
   ═══════════════════════════════════════════════════════════════ */
function calcularSaldoCompleto() {
  const ref = linhasDeReferencia();

  // Filial e tipo de cada código, tirados do sistema. É o que salva o
  // item do mapa que foi gravado sem filial.
  const filialCod = {}, tipoCod = {};
  for (const s of ref) {
    const c = sCod(s.codigo), f = sFil(s.filial);
    if (f && !filialCod[c]) filialCod[c] = f;
    if (s.tipo && !tipoCod[c]) tipoCod[c] = String(s.tipo).toUpperCase();
  }

  // ── lado do sistema ──
  const sis = new Map();
  const zerados = { n:0 };
  for (const s of ref) {
    const f = sFil(s.filial);
    if (!sPassaFilial(f)) continue;
    const saldo = Number(s.saldo) || 0;
    if (!saldo) { zerados.n++; continue; }           // lote zerado não é divergência
    const cod = sCod(s.codigo), arm = normalizarArmazem(s.armazem);
    const k = sKl(cod, s.lote, arm);
    let g = sis.get(k);
    if (!g) sis.set(k, g = {
      k, kc:sKc(cod, s.lote), cod, desc:s.descricao || '', lote:String(s.lote || '').trim().toUpperCase(),
      arm, saldo:0, empenho:0, unSis:String(s.unidade || '').trim().toUpperCase(), filial:f, foto:null,
    });
    if (s.importado_em && (!g.foto || s.importado_em < g.foto)) g.foto = s.importado_em;
    g.saldo   += saldo;
    g.empenho += Number(s.empenho) || 0;
  }

  // ── lado do mapa ──
  const mapa = new Map();
  let semFilial = 0;
  for (const [pos, itens] of Object.entries(_sOcup)) {
    for (const r of itens) {
      const cod = sCod(r.codigo);
      const f = sFil(r.filial) || filialCod[cod] || sFil(codigoFilialDoProduto(cod)) || null;
      if (!sPassaFilial(f)) { if (!f) semFilial++; continue; }
      const arm = normalizarArmazem(r.armazem);
      const k = sKl(cod, r.lote, arm);
      let g = mapa.get(k);
      if (!g) mapa.set(k, g = {
        k, kc:sKc(cod, r.lote), cod, nome:r.produto_nome || '', lote:String(r.lote || '').trim().toUpperCase(),
        arm, qtd:0, pend:0, vagas:new Set(), itens:[], dias:0, filial:f,
      });
      const q = Number(r.quantidade) || 0;
      g.qtd += q;
      if (r.pend) g.pend += q;
      g.vagas.add(pos);
      g.itens.push({ ...r, pos });
      g.dias = Math.max(g.dias, diasDesde(r.created_at));
    }
  }

  // ── vagas não confirmadas (saíram do mapa no último ciclo e ninguém decidiu) ──
  const naoConf = new Map();
  for (const r of [...(_naoConf || []), ...(_naoConfFora || [])]) {
    const cod = sCod(r.codigo);
    if (!sPassaFilial(sFil(r.filial) || filialCod[cod] || null)) continue;
    const k = sKc(cod, r.lote);
    const g = naoConf.get(k) || { qtd:0, pos:new Set() };
    g.qtd += Number(r.quantidade) || 0;
    if (r.posicao) g.pos.add(r.posicao);
    naoConf.set(k, g);
  }

  const dentro = arm => armMapeado(arm) && !_armFora.has(arm);

  // ── junta os dois lados ──
  const linhas = new Map();
  const foraMapa = [];               // mapeado em armazém que você tirou da conta
  const foraSis  = new Map();        // saldo em armazém fora da conta (desligado ou não físico)
  const nova = (base) => ({
    k:base.k, kc:base.kc, cod:base.cod, produto:base.nome || base.desc || '',
    lote:base.lote, armsMapa:[], armsSis:[], mapa:0, pend:0, sistema:null, empenho:0,
    vagas:new Set(), itens:[], dias:0, filial:base.filial, unSis:'', foto:null,
  });
  const somaMapa = (l, m) => {
    l.mapa += m.qtd; l.pend += m.pend; l.dias = Math.max(l.dias, m.dias);
    m.vagas.forEach(v => l.vagas.add(v)); l.itens.push(...m.itens);
    if (!l.armsMapa.includes(m.arm)) l.armsMapa.push(m.arm);
    if (!l.produto) l.produto = m.nome;
  };
  const somaSis = (l, s) => {
    l.sistema = (l.sistema ?? 0) + s.saldo; l.empenho += s.empenho;
    if (s.foto && (!l.foto || s.foto < l.foto)) l.foto = s.foto;
    if (!l.armsSis.includes(s.arm)) l.armsSis.push(s.arm);
    if (s.desc) l.produto = s.desc;           // a descrição do ERP manda
    l.unSis = l.unSis || s.unSis;
    l.filial = l.filial || s.filial;
  };

  for (const m of mapa.values()) {
    if (armMapeado(m.arm) && _armFora.has(m.arm)) { foraMapa.push(m); continue; }
    const l = nova(m); somaMapa(l, m); linhas.set(m.k, l);
  }
  for (const s of sis.values()) {
    const l = linhas.get(s.k);
    if (l) { somaSis(l, s); continue; }
    if (dentro(s.arm)) { const n = nova(s); somaSis(n, s); linhas.set(s.k, n); }
    else foraSis.set(s.k, s);
  }

  // ── produto trocado: órfã do mapa + no sistema o MESMO lote, no MESMO
  //    armazém e com a MESMA quantidade, mas de outro produto. Ex.: mapa
  //    com TRICH 030-25-15000 no D4 (260 L); ERP com FX PROTECTION
  //    030-25-15000 no D4 (260 L). O número do lote se repete entre
  //    produtos, então foi o produto que escolheram errado na vaga.
  //    Vem antes do "armazém trocado" porque bate lote+armazém+quantidade. ──
  {
    const tolQ = q => Math.max(0.001, Math.abs(q) * 0.0002);
    const cand = new Map();               // lote|armazém → saldos do sistema sem mapa
    const push = (x) => { const k = chave(x.lote) + '|' + x.arm; (cand.get(k) || cand.set(k, []).get(k)).push(x); };
    for (const l of linhas.values()) if (l.mapa === 0 && l.sistema > 0 && l.armsSis.length === 1)
      push({ l, cod:l.cod, lote:l.lote, arm:l.armsSis[0], qtd:l.sistema, produto:l.produto });
    for (const s of foraSis.values()) push({ s, cod:s.cod, lote:s.lote, arm:s.arm, qtd:s.saldo, produto:s.desc });
    for (const m of [...linhas.values()]) {
      if (m.sistema !== null || !(m.mapa > 0) || m.armsMapa.length !== 1) continue;
      const gem = new Set(gemeosDoProduto(m.cod));     // gêmeo de filial é o caso "codigo"
      const x = (cand.get(chave(m.lote) + '|' + m.armsMapa[0]) || [])
        .find(c => !c.usado && chave(c.cod) !== chave(m.cod) && !gem.has(normalizarCodigo(c.cod)) && Math.abs(c.qtd - m.mapa) <= tolQ(c.qtd));
      if (!x) continue;
      x.usado = true;
      const j = nova(m);
      j.k = `${m.kc}|produto`; j.produto = m.produto;
      j.mapa = m.mapa; j.pend = m.pend; j.dias = m.dias; j.itens.push(...m.itens); j.armsMapa = [...m.armsMapa];
      m.vagas.forEach(v => j.vagas.add(v));
      j.codMapa = m.cod; j.prodMapa = m.produto;
      j.codSis = normalizarCodigo(x.cod); j.prodSis = x.produto || produtoPorCodigo(x.cod)?.nome || '';
      if (x.l) {
        linhas.delete(x.l.k);
        j.sistema = x.l.sistema; j.empenho = x.l.empenho; j.armsSis = [...x.l.armsSis];
        j.foto = x.l.foto; j.unSis = x.l.unSis; j.filial = x.l.filial || j.filial;
      } else { foraSis.delete(x.s.k); somaSis(j, x.s); j.produto = m.produto; }
      linhas.delete(m.k);
      j.prodTrocado = true;
      linhas.set(j.k, j);
    }
  }

  // ── armazém trocado: órfã do mapa + órfã do sistema, mesmo produto+lote ──
  const orfasMapa = new Map(), orfasSis = new Map();
  for (const l of linhas.values()) {
    if (l.sistema === null && l.mapa > 0) (orfasMapa.get(l.kc) || orfasMapa.set(l.kc, []).get(l.kc)).push(l);
    if (l.mapa === 0 && l.sistema > 0)     (orfasSis.get(l.kc)  || orfasSis.set(l.kc, []).get(l.kc)).push(l);
  }
  // O sistema pode ter o lote num armazém fora da conta (ex.: mapeado
  // como 42, sistema diz 91). Isso também é armazém trocado — e o mais
  // importante de achar.
  const foraPorKc = new Map();
  for (const s of foraSis.values()) (foraPorKc.get(s.kc) || foraPorKc.set(s.kc, []).get(s.kc)).push(s);

  for (const [kc, ms] of orfasMapa) {
    const ss = orfasSis.get(kc) || [];
    const fs = foraPorKc.get(kc) || [];
    if (!ss.length && !fs.length) continue;
    const j = nova(ms[0]);
    j.k = `${kc}|troca`;
    j.produto = ms[0].produto;
    for (const m of ms) {
      linhas.delete(m.k);
      j.mapa += m.mapa; j.pend += m.pend; j.dias = Math.max(j.dias, m.dias);
      m.vagas.forEach(v => j.vagas.add(v)); j.itens.push(...m.itens);
      m.armsMapa.forEach(a => j.armsMapa.includes(a) || j.armsMapa.push(a));
    }
    /* Só a parte do sistema que o mapa cobre entra na troca. Ex.: mapa
       com 260 no D4, sistema com 3.805 no D7 → a troca é de 260 (D4 × D7)
       e os 3.545 que sobram continuam na linha do D7, onde é a conta
       deles. Antes o D7 inteiro vinha junto e parecia faltar 3.545. */
    let resta = j.mapa;
    j.partes = [];
    const pegar = (qtd) => { const t = Math.max(0, Math.min(qtd, resta)); resta -= t; return t; };
    for (const s of ss) {
      const t = pegar(s.sistema);
      if (!t) continue;
      j.sistema = (j.sistema ?? 0) + t;
      s.armsSis.forEach(a => j.armsSis.includes(a) || j.armsSis.push(a));
      if (s.produto) j.produto = s.produto;
      j.unSis = j.unSis || s.unSis;
      if (s.foto && (!j.foto || s.foto < j.foto)) j.foto = s.foto;
      j.partes.push({ arm:s.armsSis[0], total:s.sistema, usado:t });
      if (t >= s.sistema - 0.001) { linhas.delete(s.k); j.empenho += s.empenho; }
      else s.sistema = arred(s.sistema - t);          // o resto fica na linha dele
    }
    for (const s of fs) {
      const t = pegar(s.saldo);
      if (!t) continue;
      j.partes.push({ arm:s.arm, total:s.saldo, usado:t });
      if (t >= s.saldo - 0.001) { foraSis.delete(s.k); somaSis(j, s); }
      else {
        somaSis(j, { ...s, saldo:t, empenho:0 });
        s.saldo = arred(s.saldo - t);                 // o resto continua fora da conta
      }
    }
    if (j.sistema === null) { for (const m of ms) linhas.set(m.k, m); continue; }   // nada para trocar
    j.trocado = true;
    linhas.set(j.k, j);
  }

  // ── código de outra filial: órfã do mapa + o MESMO lote no sistema com
  //    o código gêmeo (mesmo nome, outra filial). Ex.: mapa com o TRICH
  //    da Simbiose (01007000091), ERP com o lote no da Bioma (12007000091).
  //    Armazém não importa aqui: o erro pode vir junto. ──
  const sisPorLote = new Map();
  const pushLote = (lote, x) => { const k = chave(lote); (sisPorLote.get(k) || sisPorLote.set(k, []).get(k)).push(x); };
  for (const l of linhas.values()) if (l.mapa === 0 && l.sistema > 0) pushLote(l.lote, { l, cod:l.cod });
  for (const s of foraSis.values()) pushLote(s.lote, { s, cod:s.cod });
  for (const m of [...linhas.values()]) {
    if (m.trocado || m.sistema !== null || !(m.mapa > 0)) continue;
    const gem = new Set(gemeosDoProduto(m.cod));
    if (!gem.size) continue;
    const cands = (sisPorLote.get(chave(m.lote)) || []).filter(x => !x.usado && gem.has(normalizarCodigo(x.cod)));
    if (!cands.length) continue;
    const j = nova(m);
    j.k = `${m.kc}|codigo`; j.produto = m.produto;
    j.mapa = m.mapa; j.dias = m.dias; j.itens.push(...m.itens); j.armsMapa = [...m.armsMapa];
    m.vagas.forEach(v => j.vagas.add(v));
    j.codMapa = m.cod; j.filMapa = m.filial || sFil(codigoFilialDoProduto(m.cod));
    for (const x of cands) {
      x.usado = true;
      if (x.l) {
        linhas.delete(x.l.k);
        j.sistema = (j.sistema ?? 0) + x.l.sistema; j.empenho += x.l.empenho;
        x.l.armsSis.forEach(a => j.armsSis.includes(a) || j.armsSis.push(a));
        if (x.l.foto && (!j.foto || x.l.foto < j.foto)) j.foto = x.l.foto;
        if (x.l.produto) j.produto = x.l.produto;
        j.unSis = j.unSis || x.l.unSis; j.filial = x.l.filial || j.filial;
      } else { foraSis.delete(x.s.k); somaSis(j, x.s); j.filial = x.s.filial || j.filial; }
      j.codSis = j.codSis || normalizarCodigo(x.cod);
    }
    j.filSis = sFil(codigoFilialDoProduto(j.codSis)) || j.filial;
    linhas.delete(m.k);
    j.codTrocado = true;
    linhas.set(j.k, j);
  }

  // Lotes que o sistema tem por produto — para "lote não existe" e
  // para sugerir o lote certo.
  const lotesPorCod = new Map();
  for (const s of sis.values()) {
    const c = chave(s.cod);
    (lotesPorCod.get(c) || lotesPorCod.set(c, []).get(c)).push(s);
  }

  // Saldo do sistema por lote+armazém, de qualquer produto (dica de produto trocado).
  const sisLoteArm = new Map();
  for (const s of sis.values()) { const k = chave(s.lote) + '|' + s.arm; (sisLoteArm.get(k) || sisLoteArm.set(k, []).get(k)).push(s); }

  // ── situação, unidade, paletes e dicas ──
  const lista = [...linhas.values()];
  const porKc = new Map();
  for (const l of lista) (porKc.get(l.kc) || porKc.set(l.kc, []).get(l.kc)).push(l);

  for (const l of lista) {
    l.un     = unidadeDe(l.cod, l.produto) || l.unSis || '';
    l.palete = limitePalete(l.produto, l.cod) || null;
    l.tipo   = tipoCod[l.cod] || null;
    l.arm    = l.armsSis[0] || l.armsMapa[0] || '—';   // armazém que manda no card
    l.dicas  = [];
    l.sug    = [];

    if (l.prodTrocado) {
      l.estado = 'produto';
    } else if (l.codTrocado) {
      l.estado = 'codigo';
    } else if (l.trocado) {
      l.estado = 'armazem';
    } else if (l.sistema === null) {
      const doProduto = lotesPorCod.get(chave(l.cod)) || [];
      if (doProduto.length) {
        l.estado = 'lote';
        l.sug = doProduto.filter(s => lotesParecidos(s.lote, l.lote))
          .sort((a, b) => b.saldo - a.saldo).slice(0, 3);
      } else l.estado = 'sem-saldo';
    } else if (l.mapa === 0) {
      l.estado = 'nao-mapeado';
    } else {
      const dif = l.mapa - l.sistema;
      const tol = Math.max(0.001, Math.abs(l.sistema) * 0.0002);
      l.estado = Math.abs(dif) <= tol ? 'ok' : dif < 0 ? 'falta' : 'sobra';
    }
    l.dif   = l.sistema === null ? l.mapa : arred(l.mapa - l.sistema);
    if (l.estado === 'ok') l.dif = 0;
    l.difPl = l.palete ? l.dif / l.palete : null;
    l.mapPl = l.palete ? l.mapa / l.palete : null;
    l.sisPl = l.palete && l.sistema ? l.sistema / l.palete : (l.palete ? 0 : null);
    l.achado = l.sistema ? Math.min(l.mapa, l.sistema) : 0;    // do saldo, quanto o mapa achou

    // dicas: o que pode explicar a diferença antes de ir ao galpão
    if (l.estado === 'ok') continue;
    const un = l.un;
    const nc = naoConf.get(l.kc);
    // Sem linha no sistema, vale a data da planilha do armazém do mapa.
    const mv = mexidasDepois(l.kc, l.foto || _refInfo?.porArm?.[l.armsMapa[0]]?.quando || _refInfo?.de);
    const falta = l.sistema !== null ? l.sistema - l.mapa : 0;

    if (l.estado === 'produto') {
      l.dicas.push({ t:`No mapa a vaga está como <b>${esc(l.prodMapa)}</b> (${esc(l.codMapa)}); no sistema o lote <b>${esc(l.lote)}</b> no ${esc(l.armsSis.join(', '))} com ${sQtd(l.sistema, un)} é de <b>${esc(l.prodSis)}</b> (${esc(l.codSis)}). ` +
        `Confira a etiqueta do palete: se for ${esc(l.prodSis)}, corrija o produto no mapa.`, c:'neg' });
    }
    // Mesmo lote, no mesmo armazém do mapa, com outro produto no sistema
    // (quantidade diferente, por isso não virou "produto trocado").
    if (l.sistema === null || l.estado === 'armazem' || l.estado === 'lote' || l.estado === 'sem-saldo') {
      for (const a of l.armsMapa) for (const s of sisLoteArm.get(chave(l.lote) + '|' + a) || []) {
        if (chave(s.cod) === chave(l.cod) || l.estado === 'produto') continue;
        l.dicas.push({ t:`No sistema o lote <b>${esc(s.lote)}</b> no ${esc(a)} é de outro produto: <b>${esc(s.desc || s.cod)}</b> (${esc(s.cod)}, ${sQtd(s.saldo, unidadeDe(s.cod, s.desc) || s.unSis)}). O número do lote se repete entre produtos — confira se o produto da vaga está certo.`, c:'neg' });
      }
    }
    if (l.estado === 'codigo') {
      const armDif = l.armsMapa.join() !== l.armsSis.join();
      l.dicas.push({ t:`No mapa está com o código <b>${esc(l.codMapa)}</b> ${seloFilial(l.filMapa || l.codMapa)}; no sistema este lote é do <b>${esc(l.codSis)}</b> ${seloFilial(l.filSis || l.codSis)} — mesmo produto, outra filial.` +
        (armDif ? ` E o armazém também difere: mapa ${esc(l.armsMapa.join(', '))}, sistema ${esc(l.armsSis.join(', '))}.` : '') +
        (Math.abs(l.mapa - (l.sistema || 0)) > 0.001 ? ` Depois de corrigir ainda sobra/falta ${sQtd(l.mapa - (l.sistema || 0), l.un)}.` : ' A quantidade bate.'), c:'alt' });
    }
    if (l.estado === 'armazem') {
      l.dicas.push({ t:'Mapa diz <b>' + l.armsMapa.map(esc).join(', ') + '</b>, sistema diz <b>' +
        l.armsSis.map(a => esc(a) + (nomeArmazem(a) ? ` (${esc(nomeArmazem(a))})` : '')).join(', ') + '</b>.' +
        (Math.abs(l.mapa - (l.sistema || 0)) > 0.001 ? ` E ainda sobra/falta ${sQtd(l.mapa - (l.sistema || 0), un)}.` : ' A quantidade bate.'), c:'alt' });
      for (const p of l.partes || []) if (p.total - p.usado > 0.001)
        l.dicas.push({ t:`O sistema tem ${sQtd(p.total, un)} deste lote no <b>${esc(p.arm)}</b>; só ${sQtd(p.usado, un)} estão no mapa como ${esc(l.armsMapa.join(', '))}. ` +
          `Os outros ${sQtd(p.total - p.usado, un)} continuam na conta do ${esc(p.arm)}` +
          (dentro(p.arm) ? ' — aparece em linha própria.' : ' (armazém fora da conta).'), c:'info' });
    }
    for (const a of l.armsMapa) {
      if (!armazemConhecido(a)) l.dicas.push({ t:`O armazém <b>${esc(a || 'vazio')}</b> não existe na lista física — provável digitação.`, c:'neg' });
    }
    if (l.estado === 'lote') {
      l.dicas.push(l.sug.length
        ? { t:'Lote parecido no sistema: ' + l.sug.map(s => `<b>${esc(s.lote)}</b> (arm. ${esc(s.arm)}, ${sQtd(s.saldo, un)})`).join(' · '), c:'neg' }
        : { t:'Nenhum lote parecido no sistema para este produto.', c:'neg' });
    }
    if (nc?.qtd && (falta > 0 || l.estado === 'armazem')) {
      const pos = [...nc.pos].sort();
      l.dicas.push({ t:`${sQtd(nc.qtd, un)} em vaga não confirmada (${pos.slice(0, 4).map(esc).join(', ')}${pos.length > 4 ? '…' : ''})` +
        (Math.abs(nc.qtd - falta) < 0.001 ? ' — <b>cobre exatamente a falta</b>.' : '.') + ' Decida na aba Mapa.', c:'info' });
    }
    if (l.empenho > 0 && falta > 0) {
      l.dicas.push({ t:`${sQtd(l.empenho, un)} empenhado no ERP — pode já estar separado fora do drive.`, c:'info' });
    }
    if (mv?.n) {
      l.dicas.push({ t:`${mv.n} mexida(s) no mapa depois da planilha deste armazém (última ${fmtTS(mv.ultimo)}) — pode ser saída ou entrada posterior.`, c:'warn', mexida:true });
    }
    // Falta num armazém e sobra do mesmo lote em outro: troca parcial.
    const irmas = (porKc.get(l.kc) || []).filter(o => o !== l && o.sistema !== null);
    for (const o of irmas) {
      const dif = o.mapa - o.sistema;
      if (falta > 0 && dif > 0.001)
        l.dicas.push({ t:`O mesmo lote tem sobra de ${sQtd(dif, un)} no armazém ${esc(o.armsMapa.join(', '))} — pode ser armazém trocado em parte.`, c:'alt' });
      if (l.mapa > (l.sistema || 0) && dif < -0.001)
        l.dicas.push({ t:`O mesmo lote tem falta de ${sQtd(-dif, un)} no armazém ${esc(o.armsSis.join(', '))} — pode ser armazém trocado em parte.`, c:'alt' });
    }
  }

  // O lote certo, que ficou "fora do mapa", também avisa que tem um
  // parecido digitado errado no mapa — assim a dica aparece dos dois lados.
  const porK = new Map(lista.map(l => [l.k, l]));
  for (const l of lista) {
    if (l.estado !== 'lote') continue;
    for (const s of l.sug) {
      const alvo = porK.get(s.k);
      if (alvo && (alvo.estado === 'nao-mapeado' || alvo.estado === 'falta'))
        alvo.dicas.push({ t:`No mapa tem o lote <b>${esc(l.lote)}</b> (${[...l.vagas].sort().map(esc).join(', ')}) com ${sQtd(l.mapa, l.un)} — parece este lote digitado errado.`, c:'neg' });
    }
  }

  // ── armazéns: cobertura e o que ficou fora ──
  const arms = {};
  const armDe = a => arms[a] ||= { arm:a, nome:nomeArmazem(a), fisico:armMapeado(a), fora:_armFora.has(a),
                                   lotes:0, ok:0, div:0, sisPl:0, achPl:0, mapPl:0, semPl:0, porUn:{} };
  for (const a of Object.keys(ARMAZENS)) armDe(a);
  for (const l of lista) {
    const a = armDe(l.arm);
    a.lotes++;
    if (l.estado === 'ok') a.ok++; else a.div++;
    if (l.palete) { a.sisPl += (l.sistema || 0) / l.palete; a.achPl += l.achado / l.palete; a.mapPl += l.mapa / l.palete; }
    else a.semPl++;
  }
  for (const s of foraSis.values()) {
    const a = armDe(s.arm);
    a.lotes++;
    const pl = limitePalete(s.desc, s.cod);
    if (pl) a.sisPl += s.saldo / pl; else a.semPl++;
    const un = unidadeDe(s.cod, s.desc) || s.unSis || '?';
    a.porUn[un] = (a.porUn[un] || 0) + s.saldo;
  }
  for (const m of foraMapa) {
    const a = armDe(m.arm);
    const pl = limitePalete(m.nome, m.cod);
    if (pl) a.mapPl += m.qtd / pl;
  }

  _sCalc = { lista, arms, foraSis, foraMapa, semFilial, zerados:zerados.n,
             tipos:[...new Set(Object.values(tipoCod))].sort() };
  return _sCalc;
}

/* Filtros da tabela por cima do cálculo. Os números do resumo e dos
   chips usam a lista SEM o filtro de situação, para os chips não
   zerarem uns aos outros. */
function filtrarSaldo(calc) {
  const ts   = termos($('s-busca')?.value.trim().toUpperCase() || '');
  const tipo = $('s-tipo')?.value || '';
  let base = calc.lista;
  if (_sArmFiltro) base = base.filter(l => l.arm === _sArmFiltro || l.armsMapa.includes(_sArmFiltro) || l.armsSis.includes(_sArmFiltro));
  if (tipo)        base = base.filter(l => l.tipo === tipo);
  if (ts.length)   base = base.filter(l => ts.some(x =>
    [l.produto, l.cod, l.lote, ...l.armsMapa, ...l.armsSis, ...l.vagas].join(' ').toUpperCase().includes(x)));

  let tab = _situacao === 'todas'       ? base
          : _situacao === 'divergentes' ? base.filter(l => l.estado !== 'ok')
          : base.filter(l => l.estado === _situacao);

  const mag = l => l.difPl != null ? Math.abs(l.difPl) : Math.abs(l.dif) / 1e6;  // sem palete vai para o fim do grupo
  const val = l => ({
    gravidade: null,
    paletes:   l.difPl != null ? Math.abs(l.difPl) : -1,
    produto:   l.produto, codigo:l.cod, lote:l.lote, armazem:l.arm,
    vagas:     l.vagas.size, mapeado:l.mapa, sistema:l.sistema ?? -1, dias:l.dias,
  })[_ordem];

  tab = [...tab].sort((a, b) => {
    let r;
    if (_ordem === 'gravidade') {
      r = (SITUACOES[b.estado].peso - SITUACOES[a.estado].peso) || (mag(a) - mag(b));
    } else {
      const va = val(a), vb = val(b);
      r = (typeof va === 'number' && typeof vb === 'number') ? va - vb
        : String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR');
    }
    return _ordemAsc ? r : -r;
  });
  return { base, tab };
}

/* ═══════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════ */
function renderSaldo() {
  const calc = calcularSaldoCompleto();
  const { base, tab } = filtrarSaldo(calc);
  _sReg = [];

  renderInfoRef();
  renderResumoSaldo(base);
  renderArmazensSaldo(calc);
  renderAvisosSaldo(calc);
  renderSitChips(base);

  const sel = $('s-tipo');
  if (sel) {
    const atual = sel.value;
    sel.innerHTML = `<option value="">Todos</option>` + calc.tipos.map(t => `<option ${t === atual ? 'selected' : ''}>${esc(t)}</option>`).join('');
    sel.closest('.field').hidden = !calc.tipos.length;
  }
  chipsSaldo();
  if ($('s-ordem')) $('s-ordem').value = _ordem;
  if ($('s-dir'))   $('s-dir').value   = _ordemAsc ? 'asc' : 'desc';
  if ($('s-visao')) $('s-visao').value = _sVisao;

  if (_sVisao === 'produto') renderTabelaProduto(tab);
  else renderTabelaLote(tab);
}

function renderInfoRef() {
  const info = $('s-ref-info');
  if (!info) return;
  if (!_refInfo) { info.textContent = 'nenhuma planilha importada aqui ainda'; return; }
  const arms = Object.keys(_refInfo.porArm).length;
  info.textContent = `${num(_refInfo.linhas)} linhas em ${arms} armazém(ns) · ` + (fmtDia(_refInfo.de) === fmtDia(_refInfo.ate)
    ? `importada em ${fmtTS(_refInfo.ate)}`
    : `fotos de ${fmtDia(_refInfo.de)} a ${fmtDia(_refInfo.ate)} — a data de cada armazém está no card dele`);
}

function renderResumoSaldo(base) {
  const cards = [];
  for (const [un, nome] of UNIDADES) {
    const ls = base.filter(l => l.un === un);
    if (!ls.length) continue;
    const sis = ls.reduce((s, l) => s + (l.sistema || 0), 0);
    const map = ls.reduce((s, l) => s + l.mapa, 0);
    const ach = ls.reduce((s, l) => s + l.achado, 0);
    const p = sis ? ach / sis * 100 : 0;
    cards.push(`<div class="kpi s-un">
      <div class="kpi-label">${nome} (${un})</div>
      <div class="kpi-value">${num1(p)}<small>%</small></div>
      <div class="s-barra"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div>
      <div class="kpi-foot">do saldo achado no mapa · sistema ${num(arred(sis))} · mapa ${num(arred(map))}</div>
    </div>`);
  }
  const comPl = base.filter(l => l.palete);
  const sisPl = comPl.reduce((s, l) => s + (l.sistema || 0) / l.palete, 0);
  const achPl = comPl.reduce((s, l) => s + l.achado / l.palete, 0);
  const difPl = comPl.filter(l => l.estado !== 'ok').reduce((s, l) => s + Math.abs(l.difPl), 0);
  cards.push(kpi('Paletes (equivalente)', `${num1(achPl)} <small>de ${num1(sisPl)}</small>`,
    `achados no mapa · ${num1(difPl)} pl de diferença somada`, difPl > 0.05 ? 'is-warn' : 'is-pos'));
  const ok = base.filter(l => l.estado === 'ok').length;
  cards.push(kpi('Lotes conferindo', `${num(ok)} <small>de ${num(base.length)}</small>`,
    base.length ? `${pct(ok, base.length)} dos lotes na conta` : 'nada na conta', ok === base.length && base.length ? 'is-pos' : ''));
  $('s-kpis').innerHTML = cards.join('');
}

function renderArmazensSaldo(calc) {
  const lista = Object.values(calc.arms)
    .filter(a => a.fisico || a.lotes)
    .sort((a, b) => (b.fisico - a.fisico) || (a.fora - b.fora) || (b.sisPl + b.mapPl) - (a.sisPl + a.mapPl) || a.arm.localeCompare(b.arm));

  const card = a => {
    const p = a.sisPl ? a.achPl / a.sisPl * 100 : (a.lotes ? 0 : null);
    const cls = ['s-arm', a.fora ? 'fora' : '', !a.fisico ? 'nfis' : '', _sArmFiltro === a.arm ? 'sel' : '', !a.lotes ? 'vazio' : ''].join(' ');
    const resumo = !a.lotes ? 'sem saldo nem mapa'
      : a.fora || !a.fisico ? `${num(a.lotes)} lote(s) · ${num1(a.sisPl)} pl no sistema${a.mapPl ? ` · ${num1(a.mapPl)} pl mapeados` : ''}`
      : `${num(a.ok)}/${num(a.lotes)} lotes ok · ${num1(a.achPl)} de ${num1(a.sisPl)} pl`;
    return `<div class="${cls}" ${a.lotes && !a.fora && a.fisico ? `onclick="filtrarArmSaldo('${esc(a.arm)}')"` : ''} title="${esc((a.nome || 'Armazém fora da lista') + (a.fisico ? '' : ' · não fica no mapa'))}">
      <div class="s-arm-top">
        <span class="s-arm-cod">${esc(a.arm)}</span>
        <span class="s-arm-nome">${esc(a.nome || 'fora da lista')}${!a.fisico && a.nome ? ' · não mapeado' : ''}</span>
        ${a.fisico ? `<label class="s-arm-tg" onclick="event.stopPropagation()" title="Contar este armazém na comparação">
          <input type="checkbox" ${a.fora ? '' : 'checked'} onchange="alternarArmSaldo('${esc(a.arm)}', this.checked)"></label>` : ''}
      </div>
      ${!a.fora && a.fisico && p !== null ? `<div class="s-barra"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div>` : ''}
      <div class="s-arm-pe">${!a.fora && a.fisico && p !== null ? `<b>${num1(p)}%</b> · ` : ''}${resumo}${a.div && !a.fora && a.fisico ? ` · <span class="s-neg">${num(a.div)} div.</span>` : ''}</div>
      ${_refInfo?.porArm?.[a.arm]?.quando ? `<div class="s-arm-foto${diasDesde(_refInfo.porArm[a.arm].quando) >= 2 ? ' velha' : ''}">planilha de ${fmtTS(_refInfo.porArm[a.arm].quando)}</div>` : (a.fisico ? '<div class="s-arm-foto">sem planilha</div>' : '')}
    </div>`;
  };
  $('s-arms').innerHTML = lista.map(card).join('');

  const naoFis = lista.filter(a => !a.fisico && a.lotes);
  const fora   = lista.filter(a => a.fisico && a.fora && a.lotes);
  $('s-arm-nota').textContent =
    `${lista.filter(a => a.fisico && !a.fora).length} armazém(ns) na conta` +
    (fora.length ? ` · ${fora.length} desligado(s)` : '') +
    (naoFis.length ? ` · ${naoFis.length} do ERP em armazém não mapeado (não entram)` : '') +
    ' · clique para filtrar, a caixinha tira da conta';
}

function renderAvisosSaldo(calc) {
  const av = [];
  if (!linhasDeReferencia().length) {
    av.push(`<div class="aviso a-warn"><span class="aviso-ico">!</span><div><b>Sem estoque para comparar</b>
      Solte a planilha aqui em cima. Sem ela, só dá para ver o lado do mapa.</div></div>`);
  }
  // Velha é por armazém: importar só o D7 hoje não deixa o 42 em dia.
  const velhos = Object.entries(_refInfo?.porArm || {})
    .filter(([a, p]) => armMapeado(a) && !_armFora.has(a) && p.quando && diasDesde(p.quando) >= 2)
    .sort((x, y) => String(x[1].quando).localeCompare(String(y[1].quando)));
  if (velhos.length) {
    av.push(`<div class="aviso a-warn"><span class="aviso-ico">◔</span><div><b>${velhos.length === 1 ? `A planilha do ${esc(velhos[0][0])} tem ${diasDesde(velhos[0][1].quando)} dia(s)` : `${velhos.length} armazéns com planilha de 2 dias ou mais`}</b>
      ${velhos.map(([a, p]) => `${esc(a)}: ${fmtDia(p.quando)}`).join(' · ')}. O que entrou ou saiu depois aparece como divergência — atualize só esses armazéns, se quiser.</div></div>`);
  }
  if (calc.semFilial) {
    av.push(`<div class="aviso a-warn"><span class="aviso-ico">!</span><div><b>${num(calc.semFilial)} item(ns) do mapa sem filial ficaram de fora</b>
      Nem o item nem o código dele têm filial no saldo. Tire o filtro de filial do topo para vê-los.</div></div>`);
  }
  if (calc.foraMapa.length) {
    const arms = [...new Set(calc.foraMapa.map(m => m.arm))].join(', ');
    av.push(`<div class="aviso a-info"><span class="aviso-ico">◇</span><div><b>${num(calc.foraMapa.length)} lote(s) mapeado(s) em armazém desligado (${esc(arms)})</b>
      Não entram na conta enquanto o armazém estiver desmarcado.</div></div>`);
  }
  $('s-avisos').innerHTML = av.join('');
}

function renderSitChips(base) {
  const cont = {};
  for (const l of base) cont[l.estado] = (cont[l.estado] || 0) + 1;
  const div = base.length - (cont.ok || 0);
  const bt = (id, rot, n, cor) =>
    `<button class="s-sit c-${cor}${_situacao === id ? ' on' : ''}${!n && id !== 'todas' ? ' zero' : ''}"
      onclick="setSituacaoSaldo('${id}')" title="${esc(SITUACOES[id]?.expl || '')}"><span>${rot}</span><b>${num(n)}</b></button>`;
  $('s-sits').innerHTML =
    bt('todas', 'Todas', base.length, 'mute') +
    bt('divergentes', 'Divergentes', div, 'neg') +
    ORDEM_SIT.map(id => bt(id, SITUACOES[id].rot, cont[id] || 0, SITUACOES[id].cor)).join('');
}

function chipsSaldo() {
  const c = [];
  const chip = (rot, val, limpar) =>
    `<span class="fchip">${rot}: <b>${esc(val)}</b><button title="Tirar este filtro" onclick="${limpar}">×</button></span>`;
  const q = $('s-busca').value.trim();
  if (q) c.push(chip('busca', q, `$('s-busca').value='';renderSaldo()`));
  if (_situacao !== 'todas') c.push(chip('situação', SITUACOES[_situacao]?.rot || 'Divergentes', `setSituacaoSaldo('todas')`));
  if (_sArmFiltro) c.push(chip('armazém', `${_sArmFiltro} ${nomeArmazem(_sArmFiltro)}`, `filtrarArmSaldo('')`));
  const t = $('s-tipo')?.value;
  if (t) c.push(chip('tipo', t, `$('s-tipo').value='';renderSaldo()`));
  $('s-chips').innerHTML = c.join('');
}

/* ── tabela por lote ── */
function renderTabelaLote(tab) {
  _saldoMapa = tab;
  const p = fatiar('saldo', tab, [$('s-busca').value, _situacao, _sArmFiltro, $('s-tipo')?.value, _sVisao,
    $('filtro-filial').value, [..._armFora].join()].join('|'));
  $('s-cnt').textContent = tab.length ? `${num(tab.length)} lote(s) no filtro` : 'nenhum lote no filtro atual';
  $('s-pag').innerHTML = barraPag('saldo', p, 'lote(s)');

  if (!tab.length) {
    $('s-tabela').innerHTML = `<div class="empty"><div class="empty-ico">◻</div><div class="empty-tit">Nada aqui</div><div class="empty-sub">Ajuste a situação, o armazém ou a busca.</div></div>`;
    return;
  }
  const th = (campo, rot, cls = '') =>
    `<th class="${cls}${_ordem === campo ? ' ord' + (_ordemAsc ? ' asc' : '') : ''}" onclick="ordenarSaldo('${campo}')">${rot}</th>`;
  $('s-tabela').innerHTML = `
    <table class="tbl saldo">
      <thead><tr>
        ${th('produto', 'Produto')}${th('codigo', 'Código', 'mono')}${th('lote', 'Lote', 'mono')}${th('armazem', 'Arm.', 'mono')}
        ${th('vagas', 'Vagas', 'num')}${th('mapeado', 'Mapeado', 'num')}${th('sistema', 'Sistema', 'num')}
        ${th('gravidade', 'Diferença', 'num')}${th('paletes', 'Paletes', 'num')}
      </tr></thead>
      <tbody>${p.itens.map(l => linhaLote(l)).join('')}</tbody>
    </table>`;
}

function celArm(l) {
  if (l.estado === 'armazem') return `<span class="s-troca">${l.armsMapa.map(esc).join(',')}<i>→</i>${l.armsSis.map(esc).join(',')}</span>`;
  const a = l.armsMapa[0] || l.armsSis[0] || '—';
  return armazemConhecido(a) || a === '—' ? esc(a) : `<span class="s-neg" title="Fora da lista física">${esc(a)}</span>`;
}

function celDif(l) {
  if (l.estado === 'ok') return `<span class="dif d-ok">0</span>`;
  const d = l.sistema === null ? l.mapa : l.dif;
  return `<span class="dif d-${SITUACOES[l.estado].cor}">${d > 0 ? '+' : ''}${num(arred(d))}</span><span class="s-un-tx">${esc(l.un)}</span>`;
}

function linhaLote(l, sub = false) {
  const i = _sReg.push(l) - 1;
  const aberta = _abertas.has(l.k);
  const s = SITUACOES[l.estado];
  return `
    <tr class="linha-saldo e-${s.cor}${aberta ? ' aberta' : ''}${sub ? ' sub' : ''}" onclick="alternarLinhaSaldo(${i})">
      <td class="nome strong">
        <span class="seta">${aberta ? '▾' : '▸'}</span>${esc(sub ? '' : l.produto)}
        <span class="est-rot c-${s.cor}">${s.rot}</span>
        ${l.estado !== 'ok' && l.dicas.some(d => d.mexida) ? '<span class="tag t-warn" title="Mexeram no mapa depois da planilha deste armazém">mexido</span>' : ''}
        ${l.itens.some(r => r.sep) ? `<span class="tag t-info" title="Parte do mapeado está na área de separação (pedido separado, ainda não faturado)">separado</span>` : ''}
      </td>
      <td class="mono">${l.estado === 'codigo'
        ? `<span class="s-troca">${esc(l.codMapa)}<i>→</i>${esc(l.codSis)}</span><div class="s-fils">${seloFilial(l.filMapa || l.codMapa)} → ${seloFilial(l.filSis || l.codSis)}</div>`
        : l.estado === 'produto'
        ? `<span class="s-troca">${esc(l.codMapa)}<i>→</i>${esc(l.codSis)}</span><div class="s-fils" style="font-family:inherit">no sistema: ${esc(nomeCurtoSaldo(l.prodSis))}</div>`
        : sub ? '' : `${esc(l.cod)}<div class="s-fils">${seloFilial(l.filial || l.cod)}</div>`}</td>
      <td class="mono">${esc(l.lote || '—')}</td>
      <td class="mono">${celArm(l)}</td>
      <td class="num mono">${l.vagas.size || '—'}</td>
      <td class="num mono strong">${num(arred(l.mapa))}</td>
      <td class="num mono">${l.sistema === null ? '—' : num(arred(l.sistema))}</td>
      <td class="num">${celDif(l)}</td>
      <td class="num mono">${l.estado === 'ok' ? '<span class="s-mute">0</span>' : (l.difPl == null ? '<span class="s-mute" title="Produto sem máximo por palete">—</span>' : (l.difPl > 0 ? '+' : '') + sPl(l.difPl))}</td>
    </tr>
    ${aberta ? `<tr class="detalhe-saldo"><td colspan="9">${detalheLote(l, i)}</td></tr>` : ''}`;
}

function detalheLote(l, i) {
  const s = SITUACOES[l.estado];
  const acoes = [];
  if (l.estado === 'produto' && l.itens.length)
    acoes.push(`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();corrigirMapaSaldo(${i},'produto')">Corrigir o produto no mapa para ${esc(nomeCurtoSaldo(l.prodSis))} (${esc(l.codSis)})</button>`);
  if (l.estado === 'codigo' && l.itens.length)
    acoes.push(`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();corrigirMapaSaldo(${i},'codigo')">Corrigir o código no mapa para ${esc(l.codSis)} (${esc(filialDoProduto(l.codSis)?.curto || 'outra filial')})</button>`);
  if (l.estado === 'armazem' && l.armsSis.length === 1 && l.itens.length)
    acoes.push(`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();corrigirMapaSaldo(${i},'armazem','${esc(l.armsSis[0])}')">Corrigir o mapa para o armazém ${esc(l.armsSis[0])}</button>`);
  if (l.estado === 'armazem')
    acoes.push(`<button class="btn btn-sm" onclick="event.stopPropagation();transferenciaSaldo(${i})">Criar transferência no ERP</button>`);
  if (l.estado === 'lote')
    for (const [j, sg] of l.sug.entries())
      acoes.push(`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();corrigirMapaSaldo(${i},'lote',${j})">Corrigir o lote para ${esc(sg.lote)}</button>`);
  if (l.estado !== 'ok')
    acoes.push(`<button class="btn btn-sm" onclick="event.stopPropagation();recontagemSaldo(${i})">Pedir recontagem</button>`);
  if (l.itens.length)
    acoes.push(`<button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();imprimirGrupo(${i})">⎙ Imprimir as linhas</button>`);

  const unPl = l.palete ? ` · ${num(l.palete)} ${esc(l.un)} por palete` : '';
  return `
    <div class="s-det">
      <div class="s-det-cab">
        <span><b class="c-${s.cor}">${s.rot}.</b> ${s.expl}</span>
        <span class="s-mute">${l.vagas.size} vaga(s) · mapa ${sQtd(l.mapa, l.un)} · sistema ${l.sistema === null ? '—' : sQtd(l.sistema, l.un)}${l.empenho ? ` (empenho ${sQtd(l.empenho, l.un)})` : ''}${unPl}${l.dias ? ` · parado há até ${l.dias} dia(s)` : ''}</span>
      </div>
      ${l.dicas.length ? `<ul class="s-dicas">${l.dicas.map(d => `<li class="c-${d.c}">${d.t}</li>`).join('')}</ul>` : ''}
      ${acoes.length ? `<div class="s-acoes">${acoes.join('')}</div>` : ''}
      ${l.itens.length ? `
      <table class="tbl mini">
        <thead><tr><th>Vaga</th><th>Arm.</th><th>Quantidade</th><th>Origem</th><th>Desde</th><th></th></tr></thead>
        <tbody>${[...l.itens].sort((a, b) => a.pos.localeCompare(b.pos)).map(r => `
          <tr>
            <td class="mono strong">${esc(r.pos)}</td>
            <td class="mono">${esc(normalizarArmazem(r.armazem) || '—')}</td>
            <td class="mono">${sQtd(r.quantidade, l.un)}</td>
            <td><span class="tag t-mute">${esc(r.origem || 'manual')}</span></td>
            <td class="mono">${fmtDia(r.created_at)}</td>
            <td class="acao">${r.sep
              ? `<a class="btn btn-sm" href="./mapa.html?vista=sep" target="_blank" rel="noopener" onclick="event.stopPropagation()">Ver separados</a>`
              : `<button class="btn btn-sm" onclick="event.stopPropagation();irParaVaga('${esc(r.pos)}')">Ver no mapa</button>`}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<div class="det-vazio-s">Nenhuma vaga no mapa com este lote. Ou não foi guardado no drive, ou saiu sem baixar aqui.</div>`}
    </div>`;
}

/* ── tabela por produto (produto → lotes → vagas) ── */
function renderTabelaProduto(tabLotes) {
  const grupos = new Map();
  for (const l of tabLotes) {
    const c = chave(l.cod);
    let g = grupos.get(c);
    if (!g) grupos.set(c, g = { k:'P|' + c, cod:l.cod, produto:l.produto, un:l.un, palete:l.palete, lotes:[], mapa:0, sistema:0, vagas:new Set(), pior:'ok' });
    g.lotes.push(l);
    g.mapa += l.mapa; g.sistema += l.sistema || 0;
    l.vagas.forEach(v => g.vagas.add(v));
    if (SITUACOES[l.estado].peso < SITUACOES[g.pior].peso) g.pior = l.estado;
  }
  let lista = [...grupos.values()].map(g => {
    g.dif = arred(g.mapa - g.sistema);
    g.difPl = g.palete ? g.dif / g.palete : null;
    g.lotes.sort((a, b) => SITUACOES[a.estado].peso - SITUACOES[b.estado].peso || String(a.lote).localeCompare(String(b.lote)));
    return g;
  });
  lista.sort((a, b) => {
    let r;
    if (_ordem === 'produto' || _ordem === 'codigo') r = String(_ordem === 'produto' ? a.produto : a.cod).localeCompare(_ordem === 'produto' ? b.produto : b.cod, 'pt-BR');
    else if (_ordem === 'mapeado') r = a.mapa - b.mapa;
    else if (_ordem === 'sistema') r = a.sistema - b.sistema;
    else if (_ordem === 'vagas') r = a.vagas.size - b.vagas.size;
    else r = (SITUACOES[b.pior].peso - SITUACOES[a.pior].peso) || (Math.abs(a.difPl ?? 0) - Math.abs(b.difPl ?? 0));
    return _ordemAsc ? r : -r;
  });
  _saldoMapa = tabLotes;

  const p = fatiar('saldo', lista, ['produto', $('s-busca').value, _situacao, _sArmFiltro, $('s-tipo')?.value,
    $('filtro-filial').value, [..._armFora].join()].join('|'));
  $('s-cnt').textContent = lista.length ? `${num(lista.length)} produto(s) · ${num(tabLotes.length)} lote(s) no filtro` : 'nenhum produto no filtro atual';
  $('s-pag').innerHTML = barraPag('saldo', p, 'produto(s)');
  if (!lista.length) {
    $('s-tabela').innerHTML = `<div class="empty"><div class="empty-ico">◻</div><div class="empty-tit">Nada aqui</div><div class="empty-sub">Ajuste a situação, o armazém ou a busca.</div></div>`;
    return;
  }
  const th = (campo, rot, cls = '') =>
    `<th class="${cls}${_ordem === campo ? ' ord' + (_ordemAsc ? ' asc' : '') : ''}" onclick="ordenarSaldo('${campo}')">${rot}</th>`;
  $('s-tabela').innerHTML = `
    <table class="tbl saldo">
      <thead><tr>
        ${th('produto', 'Produto')}${th('codigo', 'Código', 'mono')}<th class="mono">Lotes</th><th class="mono">Arm.</th>
        ${th('vagas', 'Vagas', 'num')}${th('mapeado', 'Mapeado', 'num')}${th('sistema', 'Sistema', 'num')}
        ${th('gravidade', 'Diferença', 'num')}${th('paletes', 'Paletes', 'num')}
      </tr></thead>
      <tbody>${p.itens.map(g => linhaProduto(g)).join('')}</tbody>
    </table>`;
}

function linhaProduto(g) {
  const i = _sReg.push(g) - 1;
  const aberta = _abertas.has(g.k);
  const s = SITUACOES[g.pior];
  const cont = {};
  g.lotes.forEach(l => cont[l.estado] = (cont[l.estado] || 0) + 1);
  const resumo = ORDEM_SIT.filter(e => cont[e]).map(e => `${cont[e]} ${SITUACOES[e].rot.toLowerCase()}`).join(' · ');
  const arms = [...new Set(g.lotes.flatMap(l => [...l.armsMapa, ...l.armsSis]))].sort();
  return `
    <tr class="linha-saldo e-${s.cor}${aberta ? ' aberta' : ''}" onclick="alternarLinhaSaldo(${i})">
      <td class="nome strong"><span class="seta">${aberta ? '▾' : '▸'}</span>${esc(g.produto)}
        <div class="sub s-mute">${resumo}</div></td>
      <td class="mono">${esc(g.cod)}</td>
      <td class="mono">${g.lotes.length}</td>
      <td class="mono">${arms.map(esc).join(', ') || '—'}</td>
      <td class="num mono">${g.vagas.size || '—'}</td>
      <td class="num mono strong">${num(arred(g.mapa))}</td>
      <td class="num mono">${num(arred(g.sistema))}</td>
      <td class="num">${g.pior === 'ok' ? '<span class="dif d-ok">0</span>' : `<span class="dif d-${Math.abs(g.dif) < 0.001 ? 'alt' : s.cor}">${g.dif > 0 ? '+' : ''}${num(g.dif)}</span><span class="s-un-tx">${esc(g.un)}</span>`}</td>
      <td class="num mono">${g.difPl == null ? '—' : (g.difPl > 0 ? '+' : '') + sPl(g.difPl)}</td>
    </tr>
    ${aberta ? g.lotes.map(l => linhaLote(l, true)).join('') : ''}`;
}

/* ═══════════════════════════════════════════════════════════════
   INTERAÇÃO
   ═══════════════════════════════════════════════════════════════ */
function alternarLinhaSaldo(i) {
  const l = _sReg[i];
  if (!l) return;
  if (_abertas.has(l.k)) _abertas.delete(l.k); else _abertas.add(l.k);
  renderSaldo();
}
function setSituacaoSaldo(s) { _situacao = s; renderSaldo(); }
function filtrarArmSaldo(a) { _sArmFiltro = _sArmFiltro === a ? '' : a; renderSaldo(); }
function alternarArmSaldo(a, ligado) {
  if (ligado) _armFora.delete(a); else _armFora.add(a);
  if (!ligado && _sArmFiltro === a) _sArmFiltro = '';
  gravarArmFora();
  renderSaldo();
}
function ordenarSaldo(campo) {
  if (_ordem === campo) _ordemAsc = !_ordemAsc;
  else { _ordem = campo; _ordemAsc = false; }
  renderSaldo();
}
function ordemSaldoSelect() {
  _ordem = $('s-ordem').value;
  _ordemAsc = $('s-dir').value === 'asc';
  renderSaldo();
}
function limparFiltrosSaldo() {
  $('s-busca').value = '';
  if ($('s-tipo')) $('s-tipo').value = '';
  _situacao = 'todas'; _sArmFiltro = '';
  _ordem = 'gravidade'; _ordemAsc = false;
  _abertas.clear();
  renderSaldo();
}

function ligarSaldo() {
  $('s-visao').addEventListener('change', e => { _sVisao = e.target.value; _abertas.clear(); renderSaldo(); });
  $('s-tipo').addEventListener('change', () => renderSaldo());
  $('s-ordem').addEventListener('change', ordemSaldoSelect);
  $('s-dir').addEventListener('change', ordemSaldoSelect);
  $('s-busca').addEventListener('input', debounce(renderSaldo, 130));
  const sel = $('s-imp-arm');
  sel.innerHTML = `<option value="">Geral — todos os armazéns</option>` +
    Object.entries(ARMAZENS).map(([a, n]) => `<option value="${esc(a)}">Só o ${esc(a)} · ${esc(n)}</option>`).join('');
  sel.addEventListener('change', atualizarTextoImport);
  atualizarTextoImport();
  configurarDropRef();
}

/* ── ações ── */

/* Corrige o armazém ou o lote dos itens do mapa para o que o sistema
   diz. É o conserto de digitação — não move mercadoria nenhuma. */
async function corrigirMapaSaldo(i, campo, valor) {
  const l = _sReg[i];
  if (!l?.itens.length) return;
  const rot = campo === 'lote' ? 'lote' : campo === 'codigo' ? 'código' : campo === 'produto' ? 'produto' : 'armazém';
  if (campo === 'produto') campo = 'codigo';      // produto trocado: troca o código (e o nome vem junto)
  const novo = campo === 'lote' ? l.sug[valor]?.lote : campo === 'codigo' ? l.codSis : normalizarArmazem(valor);
  if (!novo) return;
  if (!confirm(`Trocar o ${rot} de ${l.itens.length} item(ns) do mapa (${[...l.vagas].sort().join(', ')}) para ${novo}${l.prodSis && rot === 'produto' ? ' · ' + nomeCurtoSaldo(l.prodSis) : ''}?\n\n` +
               `Use quando o mapa estiver errado. Se o errado for o ERP, faça a transferência lá em vez disto.`)) return;
  try {
    for (const r of l.itens) {
      const antes = campo === 'lote' ? r.lote : campo === 'codigo' ? r.codigo : r.armazem;
      // Código novo leva junto o nome e a filial dele.
      const patch = campo === 'codigo'
        ? { codigo:novo, produto_nome:produtoPorCodigo(novo)?.nome || nomeCurtoSaldo(l.prodSis) || r.produto_nome, filial:codigoFilialDoProduto(novo) || r.filial }
        : { [campo]:novo };
      await atualizarResiliente(r._tab || 'historico', { ...patch, updated_at:new Date().toISOString() }, q => q.eq('id', r.id));
      await registrarAlteracao({
        acao:'ajustou', posicao:r.pos, codigo:campo === 'codigo' ? novo : sCod(r.codigo), produto_nome:patch.produto_nome || r.produto_nome,
        lote:campo === 'lote' ? novo : r.lote, armazem:campo === 'armazem' ? novo : r.armazem,
        qtd_antes:r.quantidade, qtd_depois:r.quantidade, tabela_ref:r._tab, ref_id:r.id,
        obs:`${rot} ${antes || 'vazio'} → ${novo} (Saldo mapeado)`,
      });
    }
    toast(`${rot[0].toUpperCase() + rot.slice(1)} corrigido em ${l.itens.length} item(ns).`, 'ok', 4500);
    _abertas.delete(l.k);
    await carregarSaldoMapa(true);
  } catch (e) { erro('Não consegui corrigir', e); }
}

async function recontagemSaldo(i) {
  const l = _sReg[i];
  if (!l) return;
  const arm = l.armsSis[0] || l.armsMapa[0] || null;
  if (!confirm(`Pedir recontagem de ${l.produto} · lote ${l.lote} · armazém ${arm || '—'}?\n\nAparece no celular dos conferentes.`)) return;
  try {
    await inserirResiliente('recontagens', {
      ciclo_id:_ciclo?.id ?? null, codigo:sCod(l.cod), produto_nome:l.produto,
      lote:l.lote, armazem:arm, filial:l.filial ? (FILIAIS.find(f => f.slug === l.filial)?.codigos[0] || null) : null,
      posicoes:[...l.vagas].sort().join(', ') || null,
      contagem_anterior:l.mapa, status:'aberta',
      motivo:`Saldo mapeado: ${SITUACOES[l.estado].rot.toLowerCase()}`,
      solicitado_por:GESTOR || 'painel', solicitado_em:new Date().toISOString(),
    });
    toast(`Recontagem pedida: ${l.produto} · lote ${l.lote}.`, 'ok', 5000);
  } catch (e) {
    erro(/recontagens/.test(e?.message || '') ? 'A tabela recontagens não existe — rode o migracao-validacao-auto.sql' : 'Não consegui pedir a recontagem', e);
  }
}

/* Leva para Transferências com o formulário preenchido: origem é onde
   o ERP diz, destino é onde o mapa diz. Confira antes de criar. */
function transferenciaSaldo(i) {
  const l = _sReg[i];
  if (!l) return;
  irPara('transferencias');
  $('t-codigo').value  = sCod(l.cod);
  $('t-produto').value = l.produto || '';
  $('t-lote').value    = l.lote || '';
  $('t-qtd').value     = arred(Math.min(l.mapa, l.sistema || l.mapa));
  $('t-origem').value  = l.armsSis[0] || '';
  $('t-destino').value = l.armsMapa[0] || '';
  buscarProdutoTf?.();
  toast('Confira origem e destino antes de criar a transferência.', 'warn', 5000);
}

/* Imprime as linhas do drive onde este lote está. */
function imprimirGrupo(i) {
  const l = _sReg[i];
  if (!l?.itens.length) return;
  const linhas = [...new Set(l.itens.filter(r => !r.sep).map(r => r.pos.split('-').slice(0, 2).join('-')))].sort();
  if (!linhas.length) { toast('Este lote está só na área de separação — não há linha do drive para imprimir.', 'warn', 5000); return; }
  const alvos = linhas.map(id => { const [di, ln] = id.split('-'); return alvoDaLinha(di, ln); });
  const n = paginarLinhas(caixaImpressao(), alvos, 'Espelho do drive-in', `${l.produto} · lote ${l.lote || '—'}`, 1);
  dispararImpressao(n);
}

/* Clicou numa vaga: leva para o mapa com ela aberta. */
function irParaVaga(pos) {
  const di = pos.split('-')[0];
  _pavilhao = PAV_DO_DI[di] || _pavilhao;
  irPara('mapa');
  setEscopoMapa('di:' + di);
  const cel = _mcels.find(c => c.pos === pos);
  cel?.el.scrollIntoView?.({ block:'center', behavior:'smooth' });
  abrirVaga(pos);
}

/* ── exportar ── */
function linhasExport() {
  return _saldoMapa.map(l => ({
    Produto:l.produto, Codigo:l.cod, 'Codigo no sistema':l.codSis || '', Filial:filialDoProduto(l.codSis || l.cod)?.curto || '', Lote:l.lote,
    'Arm. mapa':l.armsMapa.join(' '), 'Arm. sistema':l.armsSis.join(' '), Unidade:l.un,
    Vagas:l.vagas.size, Mapeado:arred(l.mapa), Sistema:l.sistema ?? '',
    Empenho:l.empenho || '', Diferenca:l.estado === 'ok' ? 0 : l.dif,
    'Dif. paletes':l.difPl == null ? '' : Math.round(l.difPl * 100) / 100,
    Situacao:SITUACOES[l.estado].rot,
    Dicas:l.dicas.map(d => d.t.replace(/<[^>]+>/g, '')).join(' | '),
    Posicoes:[...l.vagas].sort().join(' '),
  }));
}

function baixarCSV() {
  if (!_saldoMapa.length) { toast('Nada para exportar.', 'warn'); return; }
  const dados = linhasExport();
  const cab = Object.keys(dados[0]);
  const txt = [cab, ...dados.map(d => cab.map(c => d[c]))]
    .map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + txt], { type:'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `saldo-mapeado-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${dados.length} linha(s) exportada(s).`);
}

function imprimirSaldo() {
  const dados = _saldoMapa;
  if (!dados.length) { toast('Nada para imprimir.', 'warn'); return; }
  const cab = `<tr><th>Produto</th><th>Código</th><th>Lote</th><th>Arm.</th><th class="num">Vagas</th>` +
              `<th class="num">Mapeado</th><th class="num">Sistema</th><th class="num">Dif.</th><th class="num">Pl</th><th>Situação</th></tr>`;
  const blocos = [];
  for (let i = 0; i < dados.length; i += 24) {
    const t = document.createElement('table');
    t.className = 'p-tab';
    t.innerHTML = `<thead>${cab}</thead><tbody>` + dados.slice(i, i + 24).map(l => `
      <tr>
        <td>${esc(l.produto)}</td><td>${esc(l.cod)}</td><td>${esc(l.lote || '—')}</td>
        <td>${l.estado === 'armazem' ? esc(l.armsMapa.join(',') + ' → ' + l.armsSis.join(',')) : esc(l.arm)}</td>
        <td class="num">${l.vagas.size || '—'}</td>
        <td class="num">${num(arred(l.mapa))} ${esc(l.un)}</td>
        <td class="num">${l.sistema === null ? '—' : num(arred(l.sistema))}</td>
        <td class="num">${l.estado === 'ok' ? '0' : (l.dif > 0 ? '+' : '') + num(l.dif)}</td>
        <td class="num">${l.difPl == null || l.estado === 'ok' ? '—' : sPl(l.difPl)}</td>
        <td>${esc(SITUACOES[l.estado].rot)}</td>
      </tr>`).join('') + '</tbody>';
    blocos.push(t);
  }
  const cont = {};
  dados.forEach(l => cont[l.estado] = (cont[l.estado] || 0) + 1);
  imprimirTabela(blocos, 'Saldo mapeado × sistema',
    `${dados.length} lote(s) · ` + ORDEM_SIT.filter(e => cont[e]).map(e => `${SITUACOES[e].rot}: ${cont[e]}`).join(' · '));
}
