/* ═══════════════════════════════════════════════════════════════
   IDENTIFICAÇÃO DO PALETE (espelho de produto)
   A mesma folha que o ERP imprime: produto, unidade, tipo, código
   de barras do produto e do lote, fabricação e validade. Sai em A4,
   duas por folha (corta ao meio).

   Usado pelo mapa.html e pelo painel.html. Precisa de comum.js
   (sb, esc, $, produtoPorCodigo, normalizarCodigo) carregado antes.

   abrirIdentificacao({ codigo, produto_nome, lote, armazem })
   ═══════════════════════════════════════════════════════════════ */

const IDP_CABECALHO = 'SIMBIOSE BIOCIENCIAS S/A - ESPELHO DE PRODUTO.';

/* ── CODE 128 ────────────────────────────────────────────────────
   O mesmo tipo de código do ERP: todo leitor de mão, coletor e app
   de celular lê sem configurar nada. Usa o conjunto B (letras,
   números, traço) e passa para o C (pares de dígitos) quando há
   uma sequência grande de números — o código fica mais curto e as
   barras mais largas, o que facilita a leitura de longe. */
const C128 = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];
const C128_START_B = 104, C128_START_C = 105, C128_PARA_C = 99, C128_PARA_B = 100, C128_STOP = 106;

/* Texto → valores do Code 128 (com início, verificador e fim). */
function code128Valores(texto) {
  const s = String(texto);
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`caractere "${ch}" não cabe no código de barras`);
  }
  const digitosDesde = i => { let n = 0; while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++; return n; };
  const vals = [];
  let set = null, i = 0;
  while (i < s.length) {
    const n = digitosDesde(i);
    // Vale passar para o C: 4+ dígitos no começo ou no fim, 6+ no meio.
    const vaiC = n >= 4 && (i === 0 || i + n === s.length || n >= 6);
    if (vaiC) {
      if (n % 2) {                       // ímpar: um dígito vai no B antes
        if (set !== 'B') { vals.push(set ? C128_PARA_B : C128_START_B); set = 'B'; }
        vals.push(s.charCodeAt(i) - 32); i++;
      }
      if (set !== 'C') { vals.push(set ? C128_PARA_C : C128_START_C); set = 'C'; }
      const fim = i + (n - (n % 2 ? 1 : 0));
      for (; i < fim; i += 2) vals.push(Number(s.slice(i, i + 2)));
    } else {
      if (set !== 'B') { vals.push(set ? C128_PARA_B : C128_START_B); set = 'B'; }
      vals.push(s.charCodeAt(i) - 32); i++;
    }
  }
  if (!vals.length) vals.push(C128_START_B);
  let soma = vals[0];
  for (let k = 1; k < vals.length; k++) soma += vals[k] * k;
  vals.push(soma % 103, C128_STOP);
  return vals;
}

/* SVG vetorial: barras em múltiplos exatos do módulo e margem branca
   de 10 módulos dos dois lados (sem ela, leitor nenhum lê). */
function code128SVG(texto, { larguraMax = 150, altura = 18, moduloMax = 0.6, moduloMin = 0.33 } = {}) {
  const padrao = code128Valores(texto).map(v => C128[v]).join('');
  const quieta = 10;
  const total = quieta * 2 + [...padrao].reduce((a, d) => a + Number(d), 0);
  const mod = Math.max(moduloMin, Math.min(moduloMax, larguraMax / total));
  let x = quieta, barras = '';
  [...padrao].forEach((d, k) => {
    const w = Number(d);
    if (k % 2 === 0) barras += `<rect x="${x}" y="0" width="${w}" height="1"/>`;
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 1" preserveAspectRatio="none"
    width="${(total * mod).toFixed(2)}mm" height="${altura}mm" shape-rendering="crispEdges" role="img" aria-label="${esc(texto)}">
    <rect width="${total}" height="1" fill="#fff"/><g fill="#000">${barras}</g></svg>`;
}

/* ── DADOS DO LOTE ─────────────────────────────────────────────
   Tipo, unidade, fabricação e validade vêm da planilha do ERP
   (Saldo mapeado) ou do saldo da contagem. O que não vier, a pessoa
   digita na hora. */
const idpData = v => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
const idpBR = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

async function dadosDoLote(codigo, lote) {
  const out = { tipo:'', unidade:'', fabricacao:'', validade:'', descricao:'', origem:'' };
  if (!codigo || !lote || typeof sb === 'undefined') return out;
  const c = normalizarCodigo(codigo), l = String(lote).trim().toUpperCase();
  for (const [tab, rot] of [['estoque_ref', 'planilha do ERP'], ['saldo_sistema', 'saldo da contagem']]) {
    try {
      const { data, error } = await sb.from(tab).select('*').eq('codigo', c).eq('lote', l).limit(20);
      if (error || !data?.length) continue;
      for (const r of data) {
        const fab = idpData(r.dt_fabricacao), val = idpData(r.dt_validade);
        if (!out.tipo && r.tipo)            { out.tipo = String(r.tipo).trim().toUpperCase(); out.origem ||= rot; }
        if (!out.unidade && r.unidade)      out.unidade = String(r.unidade).trim().toUpperCase();
        if (!out.descricao && r.descricao)  out.descricao = String(r.descricao).trim();
        if (!out.fabricacao && fab)         { out.fabricacao = fab; out.origem ||= rot; }
        if (!out.validade && val)           { out.validade = val; out.origem ||= rot; }
      }
    } catch { /* tabela ou coluna ausente: segue */ }
    if (out.tipo && out.fabricacao && out.validade) break;
  }
  return out;
}

/* ── A ETIQUETA ─────────────────────────────────────────────── */
function htmlIdentificacao(d) {
  const datas = [d.fabricacao && `Data de Fabricação: ${idpBR(d.fabricacao)}`, d.validade && `Validade: ${idpBR(d.validade)}`]
    .filter(Boolean).join(' - ');
  let bcCod = '', bcLote = '';
  // Os dois códigos com a mesma largura, ocupando a etiqueta: código
  // curto (lote "C111") ganha barras mais grossas em vez de ficar
  // pequeno no meio. Barra grossa só facilita a leitura.
  const BC = { larguraMax:160, moduloMax:1.3, altura:26 };
  try { bcCod  = d.codigo ? code128SVG(d.codigo, BC) : ''; } catch { bcCod = ''; }
  try { bcLote = d.lote   ? code128SVG(d.lote, BC)   : ''; } catch { bcLote = ''; }
  return `<div class="idp-etq">
    <div class="idp-topo">${esc(IDP_CABECALHO)}</div>
    <div class="idp-corpo">
      <div class="idp-nome">${esc(d.produto || '')}</div>
      <div class="idp-linha2"><span>Unidade de Medida: ${esc(d.unidade || '')}</span><span>Tipo de Produto: ${esc(d.tipo || '')}</span></div>
      <div class="idp-bc">${bcCod}</div>
      <div class="idp-hr">${esc(d.codigo || '')}</div>
      <div class="idp-bc">${bcLote}</div>
      <div class="idp-hr">LOTE: ${esc(d.lote || '')}</div>
      <div class="idp-datas">${esc(datas)}</div>
    </div>
  </div>`;
}

/* CSS da etiqueta: o mesmo na prévia e na impressão. Courier em
   negrito, igual à do ERP. */
const IDP_CSS_ETQ = `
.idp-etq { width:194mm; height:132mm; box-sizing:border-box; border:0.35mm solid #000; background:#fff; color:#000;
  display:flex; flex-direction:column; font-family:'Courier New',Courier,monospace; font-weight:700; }
.idp-topo { border-bottom:0.35mm solid #000; text-align:center; font-size:9.5pt; padding:2.2mm 3mm; }
.idp-corpo { flex:1; display:flex; flex-direction:column; justify-content:space-between; padding:3mm 6mm 4mm; }
.idp-nome { font-size:16pt; line-height:1.15; }
.idp-linha2 { display:flex; justify-content:space-between; gap:6mm; font-size:14pt; margin-top:1mm; }
.idp-bc { text-align:center; line-height:0; margin-top:2mm; }
.idp-bc svg { display:inline-block; }
.idp-hr { text-align:center; font-size:17pt; margin-top:1.2mm; }
.idp-datas { font-size:13.5pt; text-align:center; margin-top:2mm; }
`;

/* ── IMPRESSÃO ─────────────────────────────────────────────────
   Num iframe à parte: não mexe no CSS de impressão do mapa nem do
   painel. A4 em pé, duas por folha, linha de corte no meio. */
function imprimirIdentificacoes(lista) {
  const folhas = [];
  for (let i = 0; i < lista.length; i += 2) folhas.push(lista.slice(i, i + 2));
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Identificação de palete</title>
    <style>
      @page { size:A4 portrait; margin:0; }
      * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      html, body { margin:0; padding:0; background:#fff; }
      .folha { width:210mm; height:296mm; box-sizing:border-box; padding:8mm 8mm; overflow:hidden;
        display:flex; flex-direction:column; justify-content:space-between; page-break-after:always; break-after:page; }
      .folha:last-child { page-break-after:auto; break-after:auto; }
      .metade { height:132mm; }
      .corte { border-top:0.3mm dashed #888; margin:0 -8mm; }
      ${IDP_CSS_ETQ}
    </style></head><body>
    ${folhas.map(f => `<div class="folha">
      <div class="metade">${htmlIdentificacao(f[0])}</div>
      <div class="corte"></div>
      <div class="metade">${f[1] ? htmlIdentificacao(f[1]) : ''}</div>
    </div>`).join('')}
    </body></html>`;

  document.getElementById('idp-frame')?.remove();
  const fr = document.createElement('iframe');
  fr.id = 'idp-frame';
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(fr);
  const doc = fr.contentDocument;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); }, 250);
}

/* ── O DIÁLOGO ─────────────────────────────────────────────── */
(function () {
  const st = document.createElement('style');
  st.textContent = `
  .idp-bg { position:fixed; inset:0; z-index:400; background:var(--overlay, rgba(0,0,0,.5)); display:flex; align-items:center; justify-content:center; padding:18px; }
  .idp-bg[hidden] { display:none !important; }
  .idp-cx { width:min(1040px,100%); max-height:calc(100dvh - 36px); display:flex; flex-direction:column; overflow:hidden;
    background:var(--surface,#fff); color:var(--text,#111); border:1px solid var(--line-2,#ccc); border-radius:14px; box-shadow:var(--sh, 0 12px 32px rgba(0,0,0,.3));
    font-family:var(--sans, system-ui, sans-serif); }
  .idp-cab { display:flex; align-items:baseline; gap:10px; padding:14px 18px 12px; border-bottom:1px solid var(--line,#ddd); }
  .idp-cab b { font-size:1rem; }
  .idp-cab span { font-size:.8125rem; color:var(--text-3,#777); }
  .idp-x { margin-left:auto; background:none; border:0; color:var(--text-3,#777); font-size:1.25rem; cursor:pointer; padding:2px 6px; }
  .idp-meio { display:grid; grid-template-columns:300px minmax(0,1fr); min-height:0; flex:1; overflow:auto; }
  .idp-form { padding:16px 18px; border-right:1px solid var(--line,#ddd); display:flex; flex-direction:column; gap:11px; }
  .idp-cp { display:flex; flex-direction:column; gap:4px; font-size:.75rem; font-weight:600; color:var(--text-2,#555); }
  .idp-cp input { font:inherit; font-size:.875rem; font-weight:400; color:var(--text,#111); background:var(--surface-2,#f4f4f4);
    border:1px solid var(--line,#ddd); border-radius:7px; padding:8px 10px; min-width:0; width:100%; box-sizing:border-box; }
  .idp-cp input:focus { outline:none; border-color:var(--accent,#2563eb); box-shadow:0 0 0 3px var(--accent-sf, rgba(37,99,235,.12)); }
  .idp-cp input.mono { font-family:var(--mono, monospace); }
  .idp-dois { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:10px; }
  .idp-aviso { font-size:.75rem; line-height:1.45; border-radius:7px; padding:8px 10px; background:var(--surface-2,#f4f4f4); color:var(--text-2,#555); }
  .idp-aviso.ok { background:var(--pos-sf, rgba(21,128,61,.1)); color:var(--text,#111); }
  .idp-aviso.falta { background:var(--warn-sf, rgba(166,98,6,.1)); color:var(--text,#111); }
  .idp-prev { background:var(--surface-3,#e6e9ee); padding:18px; display:flex; align-items:flex-start; justify-content:center; overflow:hidden; }
  .idp-papel { background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.18); padding:8mm; transform-origin:top center; }
  .idp-pe { display:flex; gap:8px; justify-content:flex-end; align-items:center; padding:12px 18px; border-top:1px solid var(--line,#ddd); background:var(--surface-2,#f4f4f4); }
  .idp-pe small { margin-right:auto; font-size:.75rem; color:var(--text-3,#777); }
  .idp-bt { font:inherit; font-size:.875rem; padding:9px 16px; border-radius:7px; cursor:pointer; border:1px solid var(--line-2,#ccc); background:var(--surface,#fff); color:var(--text,#111); }
  .idp-bt.pri { background:var(--accent,#2563eb); border-color:var(--accent,#2563eb); color:var(--on-accent,#fff); font-weight:600; }
  .idp-bt:disabled { opacity:.5; cursor:not-allowed; }
  ${IDP_CSS_ETQ}
  @media (max-width:760px) {
    .idp-bg { padding:0; align-items:flex-end; }
    .idp-cx { max-height:94dvh; border-radius:16px 16px 0 0; }
    .idp-meio { grid-template-columns:minmax(0,1fr); }
    .idp-form { border-right:0; border-bottom:1px solid var(--line,#ddd); }
    .idp-cp input { font-size:16px; padding:11px 12px; }
    .idp-pe { padding-bottom:calc(12px + env(safe-area-inset-bottom)); }
    .idp-pe .idp-bt { flex:1; min-height:46px; }
    .idp-pe small { display:none; }
  }`;
  document.head.appendChild(st);
})();

let _idp = null;   // dados que estão no diálogo

function montarDialogoIdentificacao() {
  if (document.getElementById('idp-bg')) return;
  const bg = document.createElement('div');
  bg.className = 'idp-bg'; bg.id = 'idp-bg'; bg.hidden = true;
  bg.innerHTML = `
    <div class="idp-cx" role="dialog" aria-modal="true" aria-labelledby="idp-tit">
      <div class="idp-cab"><b id="idp-tit">Identificação do palete</b><span>A4 · duas por folha</span>
        <button class="idp-x" onclick="fecharIdentificacao()" aria-label="Fechar">✕</button></div>
      <div class="idp-meio">
        <div class="idp-form">
          <label class="idp-cp">Produto<input id="idp-produto" autocomplete="off"></label>
          <div class="idp-dois">
            <label class="idp-cp">Código<input id="idp-codigo" class="mono" autocomplete="off"></label>
            <label class="idp-cp">Lote<input id="idp-lote" class="mono" autocomplete="off"></label>
          </div>
          <div class="idp-dois">
            <label class="idp-cp">Unidade de medida<input id="idp-unidade" class="mono" autocomplete="off"></label>
            <label class="idp-cp">Tipo de produto<input id="idp-tipo" class="mono" autocomplete="off"></label>
          </div>
          <div class="idp-dois">
            <label class="idp-cp">Fabricação<input id="idp-fab" type="date"></label>
            <label class="idp-cp">Validade<input id="idp-val" type="date"></label>
          </div>
          <label class="idp-cp">Cópias<input id="idp-copias" type="number" min="1" max="50" step="1" value="2" inputmode="numeric"></label>
          <div class="idp-aviso" id="idp-aviso">Buscando tipo e datas do lote…</div>
        </div>
        <div class="idp-prev" id="idp-prev"><div class="idp-papel" id="idp-papel"></div></div>
      </div>
      <div class="idp-pe">
        <small id="idp-folhas"></small>
        <button class="idp-bt" onclick="fecharIdentificacao()">Cancelar</button>
        <button class="idp-bt pri" id="idp-imprimir" onclick="confirmarIdentificacao()">Imprimir</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) fecharIdentificacao(); });
  bg.addEventListener('input', () => pintarIdentificacao());
  bg.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharIdentificacao(); }
  });
  addEventListener('resize', () => { if (!bg.hidden) escalarPreviaIdentificacao(); });
}

function lerDialogoIdentificacao() {
  const v = id => document.getElementById(id).value.trim();
  return {
    produto:v('idp-produto'), codigo:v('idp-codigo'), lote:v('idp-lote').toUpperCase(),
    unidade:v('idp-unidade').toUpperCase(), tipo:v('idp-tipo').toUpperCase(),
    fabricacao:v('idp-fab'), validade:v('idp-val'),
  };
}

function pintarIdentificacao() {
  const d = lerDialogoIdentificacao();
  document.getElementById('idp-papel').innerHTML = htmlIdentificacao(d);
  const n = Math.max(1, Math.min(50, parseInt(document.getElementById('idp-copias').value, 10) || 1));
  document.getElementById('idp-folhas').textContent = `${n} cópia(s) · ${Math.ceil(n / 2)} folha(s) A4`;
  let invalido = '';
  try { if (d.codigo) code128Valores(d.codigo); if (d.lote) code128Valores(d.lote); }
  catch (e) { invalido = e.message; }
  const bt = document.getElementById('idp-imprimir');
  bt.disabled = !d.codigo || !d.lote || !!invalido;
  bt.title = invalido || (!d.codigo || !d.lote ? 'Falta código ou lote' : '');
  escalarPreviaIdentificacao();
}

/* A prévia é a etiqueta em tamanho real, reduzida para caber. */
function escalarPreviaIdentificacao() {
  const box = document.getElementById('idp-prev'), papel = document.getElementById('idp-papel');
  if (!box || !papel) return;
  papel.style.transform = 'none';
  const w = papel.offsetWidth, h = papel.offsetHeight;
  const esc_ = Math.min(1, (box.clientWidth - 36) / w);
  papel.style.transform = `scale(${esc_})`;
  papel.style.marginBottom = `${-(h * (1 - esc_))}px`;
}

async function abrirIdentificacao(r) {
  montarDialogoIdentificacao();
  const cod = normalizarCodigo(r.codigo || '');
  const cat = produtoPorCodigo(cod);
  _idp = { codigo:cod, lote:String(r.lote || '').trim().toUpperCase() };
  const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
  set('idp-produto', cat?.nome || r.produto_nome || '');
  set('idp-codigo', cod);
  set('idp-lote', _idp.lote);
  set('idp-unidade', (cat?.unidade || '').toUpperCase());
  set('idp-tipo', ''); set('idp-fab', ''); set('idp-val', '');
  set('idp-copias', 2);
  const aviso = document.getElementById('idp-aviso');
  aviso.className = 'idp-aviso'; aviso.textContent = 'Buscando tipo e datas do lote…';
  document.getElementById('idp-bg').hidden = false;
  pintarIdentificacao();
  setTimeout(() => document.getElementById('idp-copias').focus(), 30);

  const d = await dadosDoLote(cod, _idp.lote);
  if (_idp?.codigo !== cod || _idp?.lote !== String(r.lote || '').trim().toUpperCase()) return;   // trocou no meio
  const vazio = id => !document.getElementById(id).value.trim();
  if (d.tipo && vazio('idp-tipo'))       set('idp-tipo', d.tipo);
  if (d.unidade && vazio('idp-unidade')) set('idp-unidade', d.unidade);
  if (d.fabricacao && vazio('idp-fab'))  set('idp-fab', d.fabricacao);
  if (d.validade && vazio('idp-val'))    set('idp-val', d.validade);
  if (!cat && d.descricao && vazio('idp-produto')) set('idp-produto', d.descricao);
  const faltam = [!d.tipo && 'tipo', !d.fabricacao && 'fabricação', !d.validade && 'validade'].filter(Boolean);
  if (!faltam.length) { aviso.className = 'idp-aviso ok'; aviso.textContent = `Tipo e datas vieram da ${d.origem}. Confira antes de imprimir.`; }
  else if (faltam.length < 3) {
    aviso.className = 'idp-aviso falta';
    aviso.textContent = `Veio da ${d.origem}, mas sem ${faltam.join(' e ')}. Preencha à mão.` +
      (!d.fabricacao && !d.validade ? ' Se a planilha do ERP tem as datas: rode o migracao-identificacao.sql e importe o armazém de novo no Saldo mapeado.' : '');
  }
  else { aviso.className = 'idp-aviso falta'; aviso.textContent = 'Este lote não está na planilha do ERP nem no saldo da contagem. Preencha tipo e datas à mão.'; }
  pintarIdentificacao();
}

function fecharIdentificacao() {
  const bg = document.getElementById('idp-bg');
  if (bg) bg.hidden = true;
  _idp = null;
}

function confirmarIdentificacao() {
  const d = lerDialogoIdentificacao();
  if (!d.codigo || !d.lote) return;
  const n = Math.max(1, Math.min(50, parseInt(document.getElementById('idp-copias').value, 10) || 1));
  imprimirIdentificacoes(Array.from({ length:n }, () => d));
}
