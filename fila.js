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

/* Um id gerado no aparelho. Vai junto na linha como `id_local`.
   Se o insert chega no banco e a resposta se perde no caminho, o
   item continua na fila e sobe de novo — com o mesmo id_local, o
   banco recusa a segunda cópia em vez de duplicar a contagem.
   Precisa de índice único em id_local:
     alter table lancamentos add column if not exists id_local text;
     create unique index if not exists lancamentos_id_local
       on lancamentos (id_local);
   Sem a coluna, o inserirResiliente/insert ignora e nada quebra. */
function idLocal() {
  try { return crypto.randomUUID(); }
  catch (e) { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
}

async function filaGravar(item) {
  const loja = await _transacao('readwrite');
  const linha = { id_local: item.linha?.id_local || idLocal(), ...item.linha };
  return new Promise((ok, falha) => {
    const req = loja.add({ ...item, linha, criado_em:new Date().toISOString(), tentativas:0 });
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
  try { return (await filaListar()).filter(i => !i.parado).length; } catch (e) { return 0; }
}

/* ═══════════════════════════════════════════════════════════════
   ENVIO
   Uma tentativa por item, em ordem. Erro de rede devolve para a
   fila; erro do banco (coluna errada, restrição) sai da fila
   depois de 5 tentativas e vira aviso — não adianta insistir.
   ═══════════════════════════════════════════════════════════════ */
let _enviando = false;

function pareceRede(e) {
  if (!navigator.onLine) return true;
  const m = String(e?.message || e || '').toLowerCase();
  // 'load' sozinho casava com "payload" e transformava erro do banco
  // em erro de rede — o item ficava tentando para sempre.
  return /failed to fetch|network|networkerror|timeout|timed out|load failed|connection|aborted|offline/.test(m);
}

/* Item que já subiu uma vez e voltou com erro de chave duplicada
   não é problema: é a resposta que se perdeu, não a contagem. */
function eDuplicado(e) {
  const m = String(e?.message || e || '').toLowerCase();
  return m.includes('duplicate key') || m.includes('already exists') ||
         String(e?.code || '') === '23505';
}

async function filaEnviar(aoMudar) {
  if (_enviando) return { enviados:0, restantes:await filaQuantos() };
  _enviando = true;
  let enviados = 0, parados = 0;

  try {
    const itens = await filaListar();
    for (const item of itens) {
      if (item.parado) continue;               // o banco já recusou: não insiste
      try {
        const { error } = await sb.from(item.tabela).insert(item.linha);
        if (error) throw error;
        await filaRemover(item.id);
        enviados++;
      } catch (e) {
        if (eDuplicado(e)) { await filaRemover(item.id); enviados++; continue; }
        if (pareceRede(e)) break;               // rede caiu de novo: para aqui
        item.tentativas = (item.tentativas || 0) + 1;
        item.ultimo_erro = String(e.message || e);
        // Antes isto apagava o lançamento depois de 5 tentativas e a
        // contagem do operador sumia sem volta. Agora fica guardado,
        // marcado, e aparece na tela para ser corrigido ou refeito.
        if (item.tentativas >= 5) { item.parado = true; parados++; }
        await filaAtualizar(item);
      }
    }
  } finally {
    _enviando = false;
  }

  const restantes = await filaQuantos();
  aoMudar?.({ enviados, restantes, parados });
  return { enviados, restantes, parados };
}

/* O que o banco recusou — some da fila de envio, não do aparelho. */
async function filaParados() {
  try { return (await filaListar()).filter(i => i.parado); } catch (e) { return []; }
}
async function filaReviver(id) {
  const itens = await filaListar();
  const it = itens.find(i => i.id === id);
  if (!it) return false;
  it.parado = false; it.tentativas = 0;
  await filaAtualizar(it);
  return true;
}

/* Tenta usar Background Sync (o navegador reenvia mesmo com o app
   fechado). Onde não existe — iOS, por exemplo — o evento `online`
   e o temporizador dão conta. */
function registrarSincronizacao() {
  navigator.serviceWorker?.ready
    .then(reg => reg.sync?.register('enviar-fila'))
    .catch(() => { /* sem Background Sync: cai no plano B */ });
}
