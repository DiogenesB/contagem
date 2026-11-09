
/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · USUARIOS.JS
   Quem está usando o sistema. Não tem senha: a pessoa escolhe o
   próprio usuário e o nome dela passa a assinar tudo o que fizer
   (QUEM, validações, alterações do mapa, lançamentos).
     perfil  gestor | assistente   (rótulo ao lado do nome)
     acesso  total  | mapa         (mapa = só o mapa.html)
   A lista vem da tabela `usuarios` (sql/migracao-usuarios.sql) e fica
   guardada no aparelho para funcionar sem internet. Sem a tabela,
   vale a lista abaixo.
   Use depois do comum.js e de criar o `sb`:
     exigirUsuario({ app:'painel' | 'mapa' | 'mobile', aoEntrar(u) })
   ═══════════════════════════════════════════════════════════════ */

const USUARIOS_PADRAO = [
  { login:'diogenes.santos', nome:'Diogenes Santos', perfil:'gestor',     acesso:'total', ativo:true },
  { login:'jeferson.habby',  nome:'Jeferson Habby',  perfil:'gestor',     acesso:'total', ativo:true },
  { login:'gabriel.farias',  nome:'Gabriel Farias',  perfil:'assistente', acesso:'total', ativo:true },
  { login:'roberto.elvino',  nome:'Roberto Elvino',  perfil:'assistente', acesso:'total', ativo:true },
  { login:'gabriel.brodtt',  nome:'Gabriel Brodtt',  perfil:'assistente', acesso:'mapa',  ativo:true },
];
const PERFIS  = { gestor:'Gestor', assistente:'Assistente' };
const ACESSOS = { total:'Acesso total', mapa:'Só o mapa' };
const LS_USU = 'usuario', LS_USU_LISTA = 'usuarios-cache';

let USUARIO = null;          // { login, nome, perfil, acesso }
let _usuarios = null;        // lista lida do banco nesta sessão
let _usuSemTabela = false;   // a tabela ainda não existe no banco

const usuNorm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function todosUsuarios() {
  if (_usuarios) return _usuarios;
  try { const c = JSON.parse(localStorage.getItem(LS_USU_LISTA) || 'null'); if (Array.isArray(c) && c.length) return c; } catch { /* sem storage */ }
  return USUARIOS_PADRAO;
}
const listaUsuarios = () => todosUsuarios().filter(u => u.ativo !== false)
  .sort((a, b) => (a.perfil === b.perfil ? 0 : a.perfil === 'gestor' ? -1 : 1) || a.nome.localeCompare(b.nome, 'pt-BR'));

async function carregarUsuarios() {
  try {
    const { data, error } = await sb.from('usuarios').select('login, nome, perfil, acesso, ativo').order('nome');
    if (error) throw error;
    _usuSemTabela = false;
    if (data?.length) {
      _usuarios = data;
      try { localStorage.setItem(LS_USU_LISTA, JSON.stringify(data)); } catch { /* sem storage */ }
    }
  } catch (e) {
    _usuSemTabela = /usuarios|relation|schema cache|PGRST/i.test(String(e?.message || e?.code || ''));
  }
  return listaUsuarios();
}

/* Pelo login (gabriel.brodtt) ou pelo nome (Gabriel Brodtt), sem
   diferença de maiúscula e acento. */
function acharUsuario(txt) {
  const t = usuNorm(txt);
  if (!t) return null;
  return listaUsuarios().find(u => usuNorm(u.login) === t || usuNorm(u.nome) === t) || null;
}
function usuarioSalvo() {
  try { return acharUsuario(localStorage.getItem(LS_USU)); } catch { return null; }
}
const podeAbrir = (u, app) => !!u && (u.acesso === 'total' || app === 'mapa');
const ehGestor  = (u = USUARIO) => u?.perfil === 'gestor';

function entrarComo(u) {
  USUARIO = u;
  try {
    localStorage.setItem(LS_USU, u.login);
    // Os apps antigos guardavam o nome cada um num lugar.
    localStorage.setItem('gestor', u.nome);
    localStorage.setItem('op-sessao', JSON.stringify({ nome:u.nome }));
  } catch { /* modo privado: vale só nesta aba */ }
  if (typeof gravarQuem === 'function') gravarQuem(u.nome);
}
function sairUsuario() {
  try { localStorage.removeItem(LS_USU); localStorage.removeItem('op-sessao'); } catch { /* */ }
  location.reload();
}

/* Pede o usuário se ainda não tem, ou se o salvo não pode abrir este app. */
async function exigirUsuario({ app, aoEntrar }) {
  await carregarUsuarios();
  const u = usuarioSalvo();
  if (u && podeAbrir(u, app)) { entrarComo(u); aoEntrar?.(u); return u; }
  mostrarLoginUsuario({ app, aoEntrar, semAcesso:u && !podeAbrir(u, app) ? u : null });
  return null;
}

/* ═══════════ TELA DE ENTRADA ═══════════ */
const USU_APP_NOME = { painel:'Painel de controle', mapa:'Mapa do drive-in', mobile:'Conferência de estoque' };

function mostrarLoginUsuario({ app, aoEntrar, semAcesso = null }) {
  usuCss();
  let bg = document.getElementById('usu-bg');
  if (!bg) { bg = document.createElement('div'); bg.id = 'usu-bg'; bg.className = 'usu-bg'; document.body.appendChild(bg); }
  bg._cfg = { app, aoEntrar };
  document.documentElement.classList.add('usu-trava');
  const lista = listaUsuarios();
  const marca = `<div class="usu-marca"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 7L12 12L22 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12V22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div>`;
  if (semAcesso) {
    bg.innerHTML = `<div class="usu-cx" role="dialog" aria-modal="true" aria-labelledby="usu-tit">
      ${marca}
      <h1 id="usu-tit">Sem acesso a esta tela</h1>
      <p><b>${esc(semAcesso.nome)}</b> tem acesso só ao <b>Mapa do drive-in</b>.</p>
      <div class="usu-acoes">
        <a class="usu-bt prim" href="./mapa.html">Abrir o mapa</a>
        <button class="usu-bt" type="button" onclick="usuTrocar()">Trocar usuário</button>
      </div>
    </div>`;
    return;
  }
  bg.innerHTML = `<div class="usu-cx" role="dialog" aria-modal="true" aria-labelledby="usu-tit">
    ${marca}
    <h1 id="usu-tit">Quem está usando?</h1>
    <p>${esc(USU_APP_NOME[app] || 'Simbiose')} · escolha o seu usuário. Não tem senha: o seu nome fica em tudo o que você alterar.</p>
    <div class="usu-lista">${lista.map(u => `
      <button type="button" class="usu-it${podeAbrir(u, app) ? '' : ' so-mapa'}" data-login="${esc(u.login)}">
        <span class="usu-av">${esc(iniciais(u.nome))}</span>
        <span class="usu-tx"><b>${esc(u.nome)}</b><small>${esc(PERFIS[u.perfil] || u.perfil)}${u.acesso === 'mapa' ? ' · só o mapa' : ''}</small></span>
      </button>`).join('')}</div>
    <form class="usu-form" onsubmit="event.preventDefault();usuEntrarTexto()">
      <label for="usu-in">ou digite o seu usuário</label>
      <div class="usu-linha">
        <input id="usu-in" type="text" placeholder="nome.sobrenome" autocomplete="username" autocapitalize="none" spellcheck="false" enterkeyhint="go">
        <button class="usu-bt prim" type="submit">Entrar</button>
      </div>
      <div class="usu-erro" id="usu-erro" role="alert"></div>
    </form>
  </div>`;
  bg.querySelectorAll('.usu-it').forEach(b => b.addEventListener('click', () => usuEscolher(acharUsuario(b.dataset.login))));
}
function usuEntrarTexto() {
  const t = document.getElementById('usu-in').value;
  const u = acharUsuario(t);
  if (!u) {
    document.getElementById('usu-erro').textContent = t.trim()
      ? `Não achei o usuário "${t.trim()}". Escolha na lista ou peça para um gestor cadastrar.`
      : 'Escolha o seu nome na lista ou digite o usuário.';
    return;
  }
  usuEscolher(u);
}
function usuEscolher(u) {
  const bg = document.getElementById('usu-bg');
  if (!u || !bg) return;
  const { app, aoEntrar } = bg._cfg || {};
  if (!podeAbrir(u, app)) {
    try { localStorage.setItem(LS_USU, u.login); } catch { /* */ }
    mostrarLoginUsuario({ app, aoEntrar, semAcesso:u });
    return;
  }
  entrarComo(u);
  bg.remove();
  document.documentElement.classList.remove('usu-trava');
  aoEntrar?.(u);
}
function usuTrocar() {
  try { localStorage.removeItem(LS_USU); } catch { /* */ }
  const bg = document.getElementById('usu-bg');
  mostrarLoginUsuario({ ...(bg?._cfg || {}) });
}

/* Estilo próprio (os três apps têm nomes de cor diferentes). */
function usuCss() {
  if (document.getElementById('usu-css')) return;
  const st = document.createElement('style');
  st.id = 'usu-css';
  st.textContent = `
  .usu-bg { --u-fundo:#0B0D10; --u-cx:#15181C; --u-it:#1B1F24; --u-it-h:#242930; --u-linha:#2C323A; --u-tx:#ECEEF1; --u-tx2:#A2A9B4; --u-tx3:#6E7681;
    --u-ac:#4C8DF6; --u-ac-dk:#2F6FE0; --u-erro:#F0655F;
    position:fixed; inset:0; z-index:9000; background:var(--u-fundo); display:flex; align-items:flex-start; justify-content:center;
    overflow-y:auto; padding:max(28px, env(safe-area-inset-top)) 16px 28px; font-family:'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif; color:var(--u-tx); }
  html[data-tema="claro"] .usu-bg { --u-fundo:#F3F4F6; --u-cx:#FFFFFF; --u-it:#F6F7F9; --u-it-h:#ECEEF2; --u-linha:#DDE1E7; --u-tx:#15181E; --u-tx2:#4B5361; --u-tx3:#7C8492;
    --u-ac:#2563EB; --u-ac-dk:#1D53C9; --u-erro:#C0342B; }
  html.usu-trava, html.usu-trava body { overflow:hidden; }
  .usu-cx { width:100%; max-width:440px; margin:auto 0; background:var(--u-cx); border:1px solid var(--u-linha); border-radius:16px; padding:28px 24px 24px; box-shadow:0 20px 50px rgba(0,0,0,.25); }
  .usu-marca { width:44px; height:44px; border-radius:12px; background:var(--u-ac-dk); color:#fff; display:flex; align-items:center; justify-content:center; margin-bottom:16px; }
  .usu-marca svg { width:24px; height:24px; }
  .usu-cx h1 { font-size:1.375rem; font-weight:650; letter-spacing:-.015em; margin:0 0 6px; }
  .usu-cx p { font-size:.875rem; line-height:1.5; color:var(--u-tx2); margin:0 0 18px; }
  .usu-cx p b { color:var(--u-tx); }
  .usu-lista { display:flex; flex-direction:column; gap:8px; }
  .usu-it { display:flex; align-items:center; gap:12px; width:100%; padding:11px 12px; border:1px solid var(--u-linha); border-radius:12px;
    background:var(--u-it); color:var(--u-tx); font:inherit; text-align:left; cursor:pointer; min-height:56px; transition:background .12s, border-color .12s; }
  .usu-it:hover, .usu-it:focus-visible { background:var(--u-it-h); border-color:var(--u-ac); outline:none; }
  .usu-it.so-mapa { opacity:.62; }
  .usu-av { width:36px; height:36px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center;
    background:var(--u-ac); color:#fff; font-size:.8125rem; font-weight:700; letter-spacing:.02em; }
  .usu-tx { display:flex; flex-direction:column; min-width:0; }
  .usu-tx b { font-size:.9375rem; font-weight:600; }
  .usu-tx small { font-size:.75rem; color:var(--u-tx3); margin-top:1px; }
  .usu-form { margin-top:20px; padding-top:16px; border-top:1px solid var(--u-linha); }
  .usu-form label { display:block; font-size:.8125rem; color:var(--u-tx2); margin-bottom:6px; }
  .usu-linha { display:flex; gap:8px; }
  .usu-linha input { flex:1; min-width:0; height:44px; padding:0 12px; border-radius:10px; border:1px solid var(--u-linha); background:var(--u-it);
    color:var(--u-tx); font:inherit; font-size:1rem; }
  .usu-linha input:focus { outline:none; border-color:var(--u-ac); box-shadow:0 0 0 3px color-mix(in srgb, var(--u-ac) 22%, transparent); }
  .usu-bt { height:44px; padding:0 16px; border-radius:10px; border:1px solid var(--u-linha); background:var(--u-it); color:var(--u-tx);
    font:inherit; font-size:.875rem; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; text-decoration:none; }
  .usu-bt.prim { background:var(--u-ac-dk); border-color:var(--u-ac-dk); color:#fff; }
  .usu-bt:hover { filter:brightness(1.08); }
  .usu-erro { font-size:.8125rem; color:var(--u-erro); margin-top:8px; min-height:1em; }
  .usu-acoes { display:flex; gap:8px; flex-wrap:wrap; }
  .usu-acoes .usu-bt { flex:1; }`;
  document.head.appendChild(st);
}

/* ═══════════ CADASTRO (painel, só gestor) ═══════════ */
async function salvarUsuario(dados) {
  const reg = {
    login:usuNorm(dados.login).replace(/\s+/g, '.'),
    nome:String(dados.nome || '').trim().replace(/\s+/g, ' '),
    perfil:dados.perfil === 'gestor' ? 'gestor' : 'assistente',
    acesso:dados.acesso === 'mapa' ? 'mapa' : 'total',
    ativo:dados.ativo !== false,
    alterado_em:new Date().toISOString(), alterado_por:USUARIO?.nome || null,
  };
  if (!/^[a-z0-9._-]{3,40}$/.test(reg.login)) throw new Error('usuário inválido — use nome.sobrenome, sem espaço');
  if (reg.nome.length < 2) throw new Error('escreva o nome');
  const { error } = await sb.from('usuarios').upsert(reg, { onConflict:'login' });
  if (error) throw error;
  await carregarUsuarios();
  return reg;
}
