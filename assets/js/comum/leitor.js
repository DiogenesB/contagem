/* ═══════════════════════════════════════════════════════════════
   LEITOR DA IDENTIFICAÇÃO (câmera)
   Lê pela câmera do celular os códigos de barras da identificação
   do palete (Code 128: o código do produto e o lote) e preenche os
   campos. Uma leitura só resolve os dois: o que tem 11 dígitos e
   existe no catálogo é o código; o resto é o lote.

   Usa o leitor nativo do navegador quando existe (Android/Chrome) e,
   nos outros (iPhone, Firefox), a biblioteca ZXing — carregada só na
   primeira vez que alguém abre a câmera.
   Leitor de mão (bipador USB/Bluetooth) continua funcionando como
   sempre: ele "digita" no campo que estiver com o cursor.

   Cada campo ganha um botão dentro dele, à direita:
     · no Código → lê o código e o lote (os dois de uma vez)
     · no Lote   → lê só o lote
   Uso: anexarLeitor({ codigo:'id-do-campo', lote:'id-do-campo',
                       aoCodigo(cod, produto), aoLote(lote), depois:'id' })
   Precisa de comum.js (produtoPorCodigo, normalizarCodigo, esc).
   ═══════════════════════════════════════════════════════════════ */

const LEITOR_ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
let _leitor = null;     // sessão aberta

/* Um botão de leitura dentro do campo do código e outro no do lote. */
function anexarLeitor(cfg) {
  if (cfg.codigo) botaoNoCampo(cfg.codigo, cfg, 'Ler o código e o lote pela câmera');
  if (cfg.lote)   botaoNoCampo(cfg.lote, { ...cfg, codigo:null, soLote:true }, 'Ler o lote pela câmera');
}

const ICONE_LEITOR = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13.5 8v8M17 8v8"/></svg>`;

function botaoNoCampo(id, cfgSessao, titulo) {
  const inp = document.getElementById(id);
  if (!inp || inp.dataset.leitor) return;
  inp.dataset.leitor = '1';
  // O botão fica dentro do campo, à direita: não disputa espaço com o
  // rótulo nem quebra a linha, em campo largo ou estreito.
  const caixa = document.createElement('span');
  caixa.className = 'leitor-campo';
  inp.parentNode.insertBefore(caixa, inp);
  caixa.appendChild(inp);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'leitor-bt';
  b.title = titulo;
  b.setAttribute('aria-label', titulo);
  b.innerHTML = ICONE_LEITOR;
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); abrirLeitor(cfgSessao); });
  caixa.appendChild(b);
}

/* Código de produto ou lote? */
function classificarLido(txt) {
  const v = String(txt || '').trim().toUpperCase();
  if (!v) return null;
  if (/^\d{8,11}$/.test(v)) {
    const cod = normalizarCodigo(v);
    if (produtoPorCodigo(cod) || v.length === 11) return { tipo:'codigo', valor:cod };
  }
  return { tipo:'lote', valor:v };
}

async function abrirLeitor(cfg) {
  if (_leitor) return;
  montarTelaLeitor();
  _leitor = { cfg, lidos:{}, ultimo:'', ultimoEm:0, stream:null, parar:null };
  pintarLidos();
  $('leitor').hidden = false;
  document.body.classList.add('leitor-aberto');
  $('leitor-msg').textContent = 'Abrindo a câmera…';

  if (!navigator.mediaDevices?.getUserMedia) { falhaLeitor('Este navegador não dá acesso à câmera. Use o Chrome ou o Safari atualizados (o site precisa estar em https).'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } },
    });
    if (!_leitor) { stream.getTracks().forEach(t => t.stop()); return; }
    _leitor.stream = stream;
    const video = $('leitor-video');
    video.srcObject = stream;
    await video.play().catch(() => {});
    pintarLidos();
    await iniciarDeteccao(video, stream);
  } catch (e) {
    falhaLeitor(/Permission|NotAllowed/i.test(e?.name + e?.message)
      ? 'A câmera foi bloqueada. Libere o acesso à câmera para este site nas configurações do navegador e tente de novo.'
      : 'Não deu para abrir a câmera: ' + (e?.message || e));
  }
}

/* Nativo se o navegador lê Code 128; senão, ZXing. */
async function iniciarDeteccao(video, stream) {
  let nativo = false;
  try { nativo = 'BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('code_128'); } catch { nativo = false; }
  if (nativo) {
    const det = new BarcodeDetector({ formats:['code_128', 'code_39', 'ean_13', 'qr_code'] });
    let vivo = true;
    _leitor.parar = () => { vivo = false; };
    const passo = async () => {
      if (!vivo || !_leitor) return;
      try { for (const c of await det.detect(video)) aoLerCodigo(c.rawValue); } catch { /* quadro ruim */ }
      setTimeout(passo, 120);
    };
    passo();
    return;
  }
  if (!window.ZXing) {
    $('leitor-msg').textContent = 'Preparando o leitor…';
    await new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = LEITOR_ZXING; s.onload = ok; s.onerror = () => falha(new Error('sem internet para baixar o leitor'));
      document.head.appendChild(s);
    });
    if (!_leitor) return;
    pintarLidos();
  }
  const dicas = new Map();
  dicas.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.QR_CODE]);
  dicas.set(ZXing.DecodeHintType.TRY_HARDER, true);
  // Lê quadro a quadro do próprio vídeo (o mesmo que a câmera mostra).
  const leitor = new ZXing.MultiFormatReader();
  leitor.setHints(dicas);
  const tela = document.createElement('canvas');
  const ctx = tela.getContext('2d', { willReadFrequently:true });
  let vivo = true;
  _leitor.parar = () => { vivo = false; };
  const passo = () => {
    if (!vivo || !_leitor) return;
    if (video.videoWidth) {
      tela.width = video.videoWidth; tela.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const r = leitor.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(tela))));
        aoLerCodigo(r.getText());
      } catch { /* nada neste quadro */ }
    }
    setTimeout(passo, 150);
  };
  passo();
}

function aoLerCodigo(txt) {
  if (!_leitor) return;
  const agora = Date.now();
  if (txt === _leitor.ultimo && agora - _leitor.ultimoEm < 1500) return;   // o mesmo código repetido no vídeo
  _leitor.ultimo = txt; _leitor.ultimoEm = agora;
  const c = classificarLido(txt);
  if (!c) return;
  const { cfg, lidos } = _leitor;
  if (c.tipo === 'codigo' && cfg.codigo) {
    if (lidos.codigo === c.valor) return;
    lidos.codigo = c.valor;
    const p = produtoPorCodigo(c.valor);
    const el = document.getElementById(cfg.codigo); if (el) el.value = c.valor;
    try { cfg.aoCodigo?.(c.valor, p); } catch (e) { console.warn(e); }
  } else if (c.tipo === 'lote' && cfg.lote) {
    if (lidos.lote === c.valor) return;
    lidos.lote = c.valor;
    const el = document.getElementById(cfg.lote); if (el) el.value = c.valor;
    try { cfg.aoLote?.(c.valor); } catch (e) { console.warn(e); }
  } else {
    // Só o lote foi pedido e leu o código do produto: avisa e continua.
    if (c.tipo === 'codigo' && cfg.soLote) {
      if (!produtoPorCodigo(c.valor)) return aoLoteNumerico(c.valor);
      $('leitor-msg').textContent = 'Esse é o código do PRODUTO — aponte para o código do LOTE';
    }
    return;
  }
  try { vibrar?.('ok'); } catch { /* sem vibração */ }
  pintarLidos();
  // Leu tudo o que o formulário pede: fecha sozinho.
  if ((!cfg.codigo || lidos.codigo) && (!cfg.lote || lidos.lote)) setTimeout(() => fecharLeitor(true), 650);
}

/* Lote só de números (raro): no modo "só lote" vale como lote. */
function aoLoteNumerico(v) {
  const { cfg, lidos } = _leitor;
  lidos.lote = v;
  const el = document.getElementById(cfg.lote); if (el) el.value = v;
  try { cfg.aoLote?.(v); } catch (e) { console.warn(e); }
  pintarLidos();
  setTimeout(() => fecharLeitor(true), 650);
}

function pintarLidos() {
  if (!_leitor) return;
  const { cfg, lidos } = _leitor;
  const chip = (rot, v, extra = '') => `<div class="leitor-chip${v ? ' ok' : ''}"><span>${rot}</span><b>${v ? esc(v) : 'aguardando…'}</b>${extra}</div>`;
  const p = lidos.codigo ? produtoPorCodigo(lidos.codigo) : null;
  if (_leitor.stream && !$('leitor').classList.contains('erro'))
    $('leitor-msg').textContent = cfg.soLote && !lidos.lote ? 'Aponte para o código de barras do LOTE'
      : cfg.codigo && !lidos.codigo
      ? (lidos.lote ? 'Agora aponte para o código de barras do PRODUTO' : 'Aponte para o código de barras da identificação')
      : cfg.lote && !lidos.lote ? 'Agora aponte para o código de barras do LOTE' : 'Pronto!';
  $('leitor-lidos').innerHTML =
    (cfg.codigo ? chip('Código', lidos.codigo, p ? `<small>${esc(p.nome)}</small>` : '') : '') +
    (cfg.lote ? chip('Lote', lidos.lote) : '');
}

function falhaLeitor(msg) {
  $('leitor-msg').textContent = msg;
  $('leitor').classList.add('erro');
}

function fecharLeitor(concluiu = false) {
  if (!_leitor) return;
  const { cfg, lidos, stream } = _leitor;
  try { _leitor.parar?.(); } catch { /* ok */ }
  stream?.getTracks().forEach(t => t.stop());
  _leitor = null;
  const v = $('leitor-video'); if (v) v.srcObject = null;
  $('leitor').hidden = true;
  $('leitor').classList.remove('erro');
  document.body.classList.remove('leitor-aberto');
  if (concluiu || lidos.codigo || lidos.lote) {
    const prox = document.getElementById(lidos.lote ? (cfg.depois || cfg.lote) : (cfg.lote || cfg.depois));
    setTimeout(() => prox?.focus(), 60);
    const n = [lidos.codigo && 'código', lidos.lote && 'lote'].filter(Boolean);
    if (n.length && typeof toast === 'function') toast(`Lido pela etiqueta: ${n.join(' e ')}.`, 'ok');
  }
}

function montarTelaLeitor() {
  if (document.getElementById('leitor')) return;
  const d = document.createElement('div');
  d.className = 'leitor'; d.id = 'leitor'; d.hidden = true;
  d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Ler etiqueta pela câmera');
  d.innerHTML = `
    <video id="leitor-video" playsinline muted autoplay></video>
    <div class="leitor-mira"><i></i></div>
    <div class="leitor-topo"><span id="leitor-msg">Abrindo a câmera…</span>
      <button type="button" class="leitor-x" onclick="fecharLeitor()" aria-label="Fechar">✕</button></div>
    <div class="leitor-baixo">
      <div class="leitor-lidos" id="leitor-lidos"></div>
      <button type="button" class="leitor-ok" onclick="fecharLeitor(true)">Pronto</button>
    </div>`;
  document.body.appendChild(d);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _leitor) { e.preventDefault(); e.stopPropagation(); fecharLeitor(); } }, true);
}

/* Estilo próprio: funciona igual no mapa e no app de contagem. */
(function () {
  const st = document.createElement('style');
  st.textContent = `
  .leitor-campo { position:relative; display:block; }
  .leitor-campo > input { padding-right:48px !important; }
  .leitor-bt { position:absolute; right:4px; top:50%; transform:translateY(-50%); z-index:2;
    width:40px; height:calc(100% - 8px); min-height:32px; max-height:44px; display:flex; align-items:center; justify-content:center;
    border:0; border-radius:8px; background:transparent; color:var(--accent, var(--blue, #2563EB)); cursor:pointer; padding:0; }
  .leitor-bt:hover { background:rgba(37,99,235,.10); }
  .leitor-bt:active { background:rgba(37,99,235,.18); }
  .leitor { position:fixed; inset:0; z-index:9000; background:#000; color:#fff; overflow:hidden; font-family:inherit; }
  .leitor[hidden] { display:none !important; }
  .leitor video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .leitor-mira { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; }
  .leitor-mira i { width:min(86vw, 560px); height:clamp(96px, 30vw, 200px); border-radius:14px;
    box-shadow:0 0 0 9999px rgba(0,0,0,.45); border:2px solid rgba(255,255,255,.9); position:relative; }
  .leitor-mira i::after { content:''; position:absolute; left:8px; right:8px; top:50%; height:2px; background:#ff4d4d; box-shadow:0 0 8px #ff4d4d; }
  .leitor-topo { position:absolute; top:0; left:0; right:0; display:flex; align-items:center; gap:10px;
    padding:calc(14px + env(safe-area-inset-top)) 16px 14px; background:linear-gradient(rgba(0,0,0,.7), transparent); font-size:.9375rem; font-weight:600; }
  .leitor-topo span { flex:1; }
  .leitor.erro .leitor-topo span { color:#ffb3b3; }
  .leitor-x { width:40px; height:40px; border-radius:50%; border:0; background:rgba(255,255,255,.16); color:#fff; font-size:1.1rem; cursor:pointer; }
  .leitor-baixo { position:absolute; left:0; right:0; bottom:0; padding:16px 16px calc(16px + env(safe-area-inset-bottom));
    background:linear-gradient(transparent, rgba(0,0,0,.8)); display:flex; flex-direction:column; gap:10px; }
  .leitor-lidos { display:flex; gap:8px; flex-wrap:wrap; }
  .leitor-chip { flex:1 1 140px; padding:9px 12px; border-radius:10px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2); }
  .leitor-chip span { display:block; font-size:.6875rem; opacity:.75; }
  .leitor-chip b { font-family:ui-monospace, Menlo, monospace; font-size:1rem; }
  .leitor-chip small { display:block; font-size:.75rem; opacity:.85; margin-top:2px; }
  .leitor-chip.ok { background:rgba(34,160,90,.35); border-color:#3ecf7c; }
  .leitor-ok { height:48px; border-radius:12px; border:0; background:#fff; color:#000; font:inherit; font-size:1rem; font-weight:700; cursor:pointer; }
  body.leitor-aberto { overflow:hidden; }
  /* celular deitado / tela baixa: tudo mais compacto */
  @media (max-height:520px) {
    .leitor-topo { padding:calc(8px + env(safe-area-inset-top)) 12px 8px; font-size:.8125rem; }
    .leitor-x { width:34px; height:34px; }
    .leitor-mira i { height:clamp(70px, 26vh, 140px); width:min(70vw, 560px); }
    .leitor-baixo { flex-direction:row; align-items:stretch; padding:10px 12px calc(10px + env(safe-area-inset-bottom)); }
    .leitor-lidos { flex:1; flex-wrap:nowrap; }
    .leitor-chip { padding:6px 10px; }
    .leitor-chip small { display:none; }
    .leitor-ok { height:auto; padding:0 22px; }
  }
  /* tablet / computador: a tela não estica demais */
  @media (min-width:900px) { .leitor-baixo { max-width:640px; margin:0 auto; left:0; right:0; } }`;
  document.head.appendChild(st);
})();
