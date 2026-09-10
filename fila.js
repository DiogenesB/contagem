/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · FILA OFFLINE
   No pavilhão a rede cai. Antes disto, um lançamento feito numa
   área de sombra simplesmente falhava e o operador perdia o
   trabalho — o service worker deixava POST passar direto e não
   havia nada guardando localmente.

   Agora: o lançamento é gravado em IndexedDB primeiro. Se a rede
   estiver de pé, ele sobe na hora e sai da fila. Se não estiver,
   fica guardado e sobe sozinho quando a conexão voltar.

   Carregue depois do comum.js e antes do script da página.
   ═══════════════════════════════════════════════════════════════ */
const FILA_DB   = 'simbiose-fila';
const FILA_LOJA = 'pendentes';
let _fdb = null;

function abrirBanco() {
  if (_fdb) return Promise.resolve(_fdb);
  return new Promise((ok, falha) => {
    const req = indexedDB.open(FILA_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILA_LOJA)) {
        db.createObjectStore(FILA_LOJA, { keyPath:'id', autoIncrement:true });
      }
    };
    req.onsuccess = () => { _fdb = req.result; ok(_fdb); };
    req.onerror   = () => falha(req.error);
  });
}

function _transacao(modo) {
  return abrirBanco().then(db => db.transaction(FILA_LOJA, modo).objectStore(FILA_LOJA));
}

async function filaGravar(item) {
  const loja = await _transacao('readwrite');
  return new Promise((ok, falha) => {
    const req = loja.add({ ...item, criado_em:new Date().toISOString(), tentativas:0 });
    req.onsuccess = () => ok(req.result);
    req.onerror   = () => falha(req.error);
  });
}

async function filaListar() {
  const loja = await _transacao('readonly');
  return new Promise((ok, falha) => {
    const req = loja.getAll();
    req.onsuccess = () => ok(req.result || []);
    req.onerror   = () => falha(req.error);
  });
}

async function filaRemover(id) {
  const loja = await _transacao('readwrite');
  return new Promise((ok, falha) => {
    const req = loja.delete(id);
    req.onsuccess = () => ok();
    req.onerror   = () => falha(req.error);
  });
}

async function filaAtualizar(item) {
  const loja = await _transacao('readwrite');
  return new Promise((ok, falha) => {
    const req = loja.put(item);
    req.onsuccess = () => ok();
    req.onerror   = () => falha(req.error);
  });
}

async function filaQuantos() {
  try { return (await filaListar()).length; } catch (e) { return 0; }
}

/* ═══════════════════════════════════════════════════════════════
   ENVIO
   Uma tentativa por item, em ordem. Erro de rede devolve para a
   fila; erro do banco (coluna errada, restrição) sai da fila
   depois de 5 tentativas e vira aviso — não adianta insistir.
   ═══════════════════════════════════════════════════════════════ */
let _enviando = false;

function pareceRede(e) {
  const m = String(e?.message || e || '').toLowerCase();
  return !navigator.onLine || m.includes('fetch') || m.includes('network') ||
         m.includes('failed') || m.includes('timeout') || m.includes('load');
}

async function filaEnviar(aoMudar) {
  if (_enviando) return { enviados:0, restantes:await filaQuantos() };
  _enviando = true;
  let enviados = 0, descartados = 0;

  try {
    const itens = await filaListar();
    for (const item of itens) {
      try {
        const { error } = await sb.from(item.tabela).insert(item.linha);
        if (error) throw error;
        await filaRemover(item.id);
        enviados++;
      } catch (e) {
        if (pareceRede(e)) break;               // rede caiu de novo: para aqui
        item.tentativas = (item.tentativas || 0) + 1;
        item.ultimo_erro = String(e.message || e);
        if (item.tentativas >= 5) { await filaRemover(item.id); descartados++; }
        else await filaAtualizar(item);
      }
    }
  } finally {
    _enviando = false;
  }

  const restantes = await filaQuantos();
  aoMudar?.({ enviados, restantes, descartados });
  return { enviados, restantes, descartados };
}

/* Tenta usar Background Sync (o navegador reenvia mesmo com o app
   fechado). Onde não existe — iOS, por exemplo — o evento `online`
   e o temporizador dão conta. */
function registrarSincronizacao() {
  navigator.serviceWorker?.ready
    .then(reg => reg.sync?.register('enviar-fila'))
    .catch(() => { /* sem Background Sync: cai no plano B */ });
}