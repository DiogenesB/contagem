/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · IMPRESSÃO
   O espelho do drive-in, em A4 vertical, usado pelos três apps:
   painel, mapa e app do operador. O CSS e o diálogo nascem daqui —
   nenhuma das três páginas precisa carregar nada disso.

   Carregue depois do comum.js. Antes de usar, diga de onde vêm os
   dados:

     configurarImpressao({
       ocupacaoDe: pos => _ocupacao[pos] || [],
       contexto:   () => ({ pav:'simbiose', di:'B1', q:'', visiveis:[...] }),
     });
   ═══════════════════════════════════════════════════════════════ */

const IMP = {
  ocupacaoDe: () => [],
  contexto:   () => ({ pav:null, di:null, q:'', visiveis:[] }),
};
function configurarImpressao(cfg) { Object.assign(IMP, cfg); }

const PG_A4 = { larg:'190mm', alt:'277mm' };

/* ═══════════ CSS ═══════════ */
/* Injetado uma vez, no carregamento. Assim a folha impressa é
   idêntica nos três apps — corrigir aqui corrige em todos. */
(function estiloImpressao() {
  const st = document.createElement('style');
  st.id = 'css-impressao';
  st.textContent = `
#impressao { position:absolute; left:-99999px; top:0; }
.pg { background:#fff; color:#000; display:flex; flex-direction:column;
      font-family:var(--sans, sans-serif); overflow:hidden; }
.pg-topo { display:flex; align-items:baseline; gap:10px; font-size:10pt;
           border-bottom:1.5px solid #000; padding-bottom:5px; margin-bottom:8px; }
.pg-topo b { font-size:12pt; }
.pg-topo .dir { margin-left:auto; font-size:8.5pt; color:#444; }
.pg-corpo { flex:1; overflow:hidden; }
.pg-pe { display:flex; border-top:1px solid #999; padding-top:4px; margin-top:8px;
         font-size:8pt; color:#444; }
.pg-num { margin-left:auto; font-weight:700; color:#000; }
.p-grade { display:grid; gap:8px; align-content:start; }
.p-linha { border:1px solid #000; border-radius:3px; padding:7px 8px; break-inside:avoid; }
.p-lh { display:flex; justify-content:space-between; align-items:baseline;
        border-bottom:1px solid #000; padding-bottom:4px; margin-bottom:6px; }
.p-titulo { font-family:var(--mono, monospace); font-weight:700; }
.p-lh span:last-child { font-size:8pt; color:#444; }
.p-lh small { font-weight:400; font-size:8pt; color:#666; }
.p-vazio { font-size:8pt; color:#777; font-style:italic; padding:6px 5px; }
.p-assina { display:flex; gap:24px; margin-top:10px; padding-top:4px; font-size:8pt; color:#555; }
.p-assina span { flex:1; border-top:1px solid #000; padding-top:3px; }
table.p-tab { width:100%; border-collapse:collapse; }
table.p-tab th { text-align:left; border-bottom:1.2px solid #000; padding:3px 5px; }
table.p-tab td { border-bottom:1px solid #ddd; padding:3px 5px; }
table.p-tab .num { text-align:right; font-variant-numeric:tabular-nums; }
table.p-tab .forte { font-family:var(--mono, monospace); font-weight:700; }
table.p-tab td { vertical-align:middle; }
table.p-tab .p-bc { padding-top:4px; padding-bottom:4px; }
table.p-tab .p-bc svg { display:block; max-width:100%; }
table.p-tab.p-tab-bc { table-layout:fixed; }
table.p-tab.p-tab-bc td { overflow:hidden; }
table.p-tab.p-tab-bc .forte { white-space:nowrap; font-size:8.5pt; }
table.p-tab .p-bc small { display:block; font-family:var(--mono, monospace); font-size:7pt; color:#000; letter-spacing:.04em; margin-top:1px; }
table.p-tab .p-sub { display:block; font-size:7.5pt; color:#444; margin-top:1px; }
table.p-tab .p-lote { font-family:var(--mono, monospace); font-weight:700; }
table.p-tab tr.tot td { border-top:1.5px solid #000; font-weight:700; }
.pg-por-1 .p-lh { font-size:15pt; }
.pg-por-1 table.p-tab { font-size:11pt; }
.pg-por-1 table.p-tab td { padding:7px 6px; }
.pg-por-2 .p-lh { font-size:11pt; }
.pg-por-2 table.p-tab { font-size:9pt; }
.pg-por-4 .p-lh { font-size:9pt; }
.pg-por-4 table.p-tab { font-size:7.5pt; }
.pg-por-0 table.p-tab { font-size:8pt; }
/* Diálogo. Classes próprias (imp-*) de propósito: .modal e .bt já
   significam outra coisa no painel e no app do operador — usar
   esses nomes aqui reescrevia as folhas de baixo do celular. */
.imp-modal { position:fixed; inset:0; z-index:400; display:flex;
  align-items:center; justify-content:center; padding:18px;
  background:var(--overlay, rgba(0,0,0,.55)); }
.imp-modal[hidden] { display:none; }
.imp-cx { width:min(460px,100%); max-height:88dvh; display:flex; flex-direction:column;
  overflow:hidden; border-radius:var(--r, 10px);
  background:var(--surface, #fff); color:var(--text, #111);
  border:1px solid var(--line, #ddd); box-shadow:var(--sh, 0 12px 32px rgba(0,0,0,.3)); }
.imp-topo { display:flex; align-items:center; padding:14px 16px 12px;
  border-bottom:1px solid var(--line, #ddd); }
.imp-topo b { font-size:.9375rem; }
.imp-x { margin-left:auto; background:none; border:0; cursor:pointer;
  color:var(--text-3, #888); font-size:1.125rem; line-height:1; padding:4px 7px; }
.imp-corpo { padding:16px; overflow:auto; }
.imp-pe { display:flex; gap:8px; justify-content:flex-end; padding:12px 16px;
  border-top:1px solid var(--line, #ddd); background:var(--surface-2, #f5f5f5); }
.imp-bt { background:var(--surface-2, #f5f5f5); border:1px solid var(--line, #ddd);
  border-radius:var(--r-sm, 7px); color:var(--text, #111); font:inherit; font-size:.875rem;
  padding:9px 15px; cursor:pointer; min-height:40px; }
.imp-bt.imp-ok { background:var(--accent, #2563EB); border-color:var(--accent, #2563EB);
  color:#fff; font-weight:600; }
.imp-bt:disabled { opacity:.45; cursor:not-allowed; }
.imp-campo { display:block; margin-bottom:16px; }
.imp-campo > span { display:block; font-size:.75rem; font-weight:600;
  color:var(--text-2, #555); margin-bottom:6px; }
.imp-campo input[type="text"] { width:100%; padding:10px 12px; font-size:.875rem;
  font-family:var(--mono, monospace); border-radius:var(--r-sm, 7px);
  background:var(--surface-2, #f5f5f5); border:1px solid var(--line, #ddd); color:var(--text, #111); }
.imp-campo small { display:block; margin-top:6px; font-size:.6875rem;
  color:var(--text-3, #888); line-height:1.5; }
.imp-campo code { font-family:var(--mono, monospace); font-size:.6875rem;
  background:var(--surface-3, #e8e8e8); border-radius:3px; padding:1px 4px; }
.imp-chk { display:flex; align-items:flex-start; gap:9px; margin-bottom:10px; font-size:.8125rem; cursor:pointer; }
.imp-chk input { margin-top:2px; width:17px; height:17px; accent-color:var(--accent, #2563EB); }
.imp-seg { display:flex; gap:3px; padding:3px; border-radius:var(--r-sm, 7px);
  background:var(--surface-2, #f5f5f5); border:1px solid var(--line, #ddd); }
.imp-seg button { flex:1; border:0; background:transparent; color:var(--text-2, #555);
  font:inherit; font-size:.875rem; padding:8px; border-radius:5px; cursor:pointer; min-height:38px; }
.imp-seg button.on { background:var(--surface-3, #e8e8e8); color:var(--text, #111); font-weight:600; }
.imp-conta { margin-top:14px; padding:10px 12px; border-radius:var(--r-sm, 7px);
  background:var(--accent-sf, rgba(37,99,235,.09)); border:1px solid var(--accent-ln, rgba(37,99,235,.28));
  font-family:var(--mono, monospace); font-size:.75rem; color:var(--accent, #2563EB); }

@media print {
  body { height:auto !important; overflow:visible !important; }
  body > *:not(#impressao) { display:none !important; }
  #impressao { position:static !important; left:0 !important; }
  .pg { break-after:page; }
  .pg:last-child { break-after:auto; }
}`;
  document.head.appendChild(st);
})();

function caixaImpressao() {
  let el = document.getElementById('impressao');
  if (!el) {
    el = document.createElement('div');
    el.id = 'impressao';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  return el;
}

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

/* ═══════════ LINHAS ═══════════ */
function posicoesDaLinha(pav, di, ln) {
  const linhas = MAPA_POSICOES[pav]?.[di]?.[ln];
  if (!linhas) return [];
  const out = [];
  for (const an of Object.keys(linhas).sort((a, b) => b - a)) {
    for (const lg of linhas[an]) out.push(`${di}-${ln}-${an}-${lg}`);
  }
  return out;
}

function alvoDaLinha(di, ln, pav) {
  const p = pav || Object.keys(MAPA_POSICOES).find(x => MAPA_POSICOES[x][di]);
  return { pav:p, di, ln, posicoes:posicoesDaLinha(p, di, ln) };
}

/* Aceita "B1-01", "01", "B1", "B1-01..14" e listas por vírgula.
   Número solto vale para todos os drive-ins que estão à vista. */
function parseLinhas(txt) {
  const { visiveis } = IMP.contexto();
  const disponiveis = (visiveis || []).map(x => x.di);
  const alvos = [];
  const pad = n => String(n).padStart(2, '0');

  const push = (di, ln) => {
    const alvo = alvoDaLinha(di, ln);
    if (!alvo.posicoes.length) return;
    if (alvos.some(a => a.di === di && a.ln === ln)) return;
    alvos.push(alvo);
  };

  for (const bruto of String(txt).toUpperCase().split(/[,;]+|\s+/).filter(Boolean)) {
    const faixa = bruto.split('..');
    if (faixa.length === 2) {
      const mA = faixa[0].match(/^([A-Z]\d)-(\d+)$/) || faixa[0].match(/^(\d+)$/);
      const nB = (faixa[1].match(/^[A-Z]\d-(\d+)$/) || faixa[1].match(/^(\d+)$/) || [])[1];
      if (!mA || !nB) continue;
      const di = mA.length === 3 ? mA[1] : null;
      const n1 = Number(mA.length === 3 ? mA[2] : mA[1]), n2 = Number(nB);
      for (const d of (di ? [di] : disponiveis)) {
        for (let n = Math.min(n1, n2); n <= Math.max(n1, n2); n++) push(d, pad(n));
      }
      continue;
    }
    const comDI = bruto.match(/^([A-Z]\d)-(\d+)$/);
    if (comDI) { push(comDI[1], pad(comDI[2])); continue; }
    const soDI = bruto.match(/^([A-Z]\d)$/);
    if (soDI) {
      const pav = Object.keys(MAPA_POSICOES).find(p => MAPA_POSICOES[p][soDI[1]]);
      if (pav) for (const ln of Object.keys(MAPA_POSICOES[pav][soDI[1]]).sort()) push(soDI[1], ln);
      continue;
    }
    const soNum = bruto.match(/^(\d+)$/);
    if (soNum) for (const d of disponiveis) push(d, pad(soNum[1]));
  }
  return alvos;
}

function itensDaLinhaImp(alvo) {
  const out = [];
  for (const pos of alvo.posicoes) {
    const [, , an, lg] = pos.split('-');
    for (const r of IMP.ocupacaoDe(pos)) out.push({ vaga:`${an}.${lg}`, pos, r });
  }
  return out;
}

/* Código de barras (Code 128) do produto e do lote na folha da linha:
   a pessoa bipa direto do papel. Com 4 linhas por folha não cabe —
   aí sai só o texto. */
const IMP_BC = {
  1:{ altura:9, cod:36, lote:52 },   // altura e largura máxima em mm
  2:{ altura:7, cod:36, lote:52 },
};
function bcImp(texto, por, tipo) {
  const cfg = IMP_BC[por];
  if (!cfg || !texto || typeof code128SVG !== 'function') return '';
  try {
    return code128SVG(String(texto).trim(),
      { altura:cfg.altura, larguraMax:cfg[tipo], moduloMin:0.19, moduloMax:0.4 });
  } catch (e) { return ''; }
}

function ocupadasDaLinhaImp(alvo) {
  return alvo.posicoes.filter(p => IMP.ocupacaoDe(p).length).length;
}

/* ═══════════ FOLHA ═══════════ */
function cascaDaLinha(alvo, continuacao, por) {
  const { di, ln, pav, posicoes } = alvo;
  const d = document.createElement('div');
  d.className = 'p-linha';
  d.innerHTML = `
    <div class="p-lh">
      <span class="p-titulo">${di}-${ln}${continuacao ? ' <small>(continuação)</small>' : ''}</span>
      <span>${pav ? nomeDoPavilhao(pav) + ' · ' : ''}${ocupadasDaLinhaImp(alvo)}/${posicoes.length} vagas ocupadas</span>
    </div>
    <table class="p-tab${IMP_BC[por] ? ' p-tab-bc' : ''}">${IMP_BC[por]
      ? '<colgroup><col style="width:12%"><col style="width:26%"><col style="width:21%"><col style="width:12%"><col style="width:29%"></colgroup>' : ''}<thead><tr>${IMP_BC[por]
      ? '<th>Posição</th><th>Produto</th><th>Código de barras</th><th>Lote</th><th>Código de barras</th>'
      : '<th>Vaga</th><th>Produto</th><th>Lote</th><th>Arm.</th><th class="num">Quantidade</th>'}
    </tr></thead><tbody></tbody></table>
    ${por === 1 ? '<div class="p-assina"><span>Conferido por</span><span>Data</span></div>' : ''}`;
  return d;
}

function nomeDoPavilhao(p) {
  return p === 'simbiose' ? 'Simbiose' : p === 'bioma' ? 'Bioma' : 'Simbiose + Bioma';
}

function trDoItem({ vaga, pos, r }, por) {
  const tr = document.createElement('tr');
  if (IMP_BC[por]) {
    const cod = normalizarCodigo(r.codigo);
    tr.innerHTML = `
    <td class="forte">${esc(pos)}</td>
    <td>${esc(r.produto_nome || r.codigo)}<span class="p-sub">arm. ${esc(r.armazem || '—')} · ${num(r.quantidade)} ${esc(unidadeDe(r.codigo, r.produto_nome) || '')}</span></td>
    <td class="p-bc">${bcImp(cod, por, 'cod')}<small>${esc(cod)}</small></td>
    <td class="p-lote" style="word-break:break-all">${esc(r.lote || '—')}</td>
    <td class="p-bc">${r.lote ? bcImp(r.lote, por, 'lote') + `<small>${esc(r.lote)}</small>` : '—'}</td>`;
    return tr;
  }
  tr.innerHTML = `
    <td class="forte">${vaga}</td>
    <td>${esc(r.produto_nome || r.codigo)}</td>
    <td>${esc(r.lote || '—')}</td>
    <td>${esc(r.armazem || '—')}</td>
    <td class="num">${num(r.quantidade)}</td>`;
  return tr;
}

function novaPagina(titulo, sub, por) {
  const p = document.createElement('div');
  p.className = 'pg pg-por-' + por;
  p.style.width  = PG_A4.larg;
  p.style.height = PG_A4.alt;
  p.innerHTML = `
    <div class="pg-topo">
      <b>${esc(titulo)}</b><span>${esc(sub)}</span>
      <span class="dir">${new Date().toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' })}</span>
    </div>
    <div class="pg-corpo"></div>
    <div class="pg-pe"><span>Simbiose Agro · controle de estoque</span><span class="pg-num"></span></div>`;
  return p;
}

/* As linhas da tabela entram uma a uma, medindo o espaço: quando
   acaba, a folha continua na página seguinte. É o que impede uma
   linha cheia de ser cortada no meio. */
function paginarLinhas(raiz, alvos, titulo, sub, por) {
  raiz.innerHTML = '';
  let pagina, corpo, caixa, usados = 0;

  const abrirPagina = () => {
    pagina = novaPagina(titulo, sub, por);
    raiz.appendChild(pagina);
    corpo = pagina.querySelector('.pg-corpo');
    caixa = document.createElement('div');
    caixa.className = 'p-grade';
    caixa.style.gridTemplateColumns = por === 4 ? '1fr 1fr' : '1fr';
    corpo.appendChild(caixa);
    usados = 0;
  };
  const estourou = () => corpo.scrollHeight > corpo.clientHeight + 1;
  // Teto de segurança para o caso de a medição do navegador voltar
  // zerada, o que acontece em alguns contextos de impressão.
  const teto = { 1:16, 2:8, 4:7 }[por] || 26;   // com código de barras a linha é mais alta
  abrirPagina();

  for (const alvo of alvos) {
    const itens = itensDaLinhaImp(alvo);
    let i = 0, continuacao = false, voltas = 0;
    do {
      if (usados >= por) abrirPagina();
      const casca = cascaDaLinha(alvo, continuacao, por);
      caixa.appendChild(casca); usados++;
      if (estourou() && usados > 1) {
        caixa.removeChild(casca); usados--;
        abrirPagina();
        caixa.appendChild(casca); usados++;
      }

      const tbody = casca.querySelector('tbody');
      let postas = 0;
      while (i < itens.length) {
        if (postas >= teto) break;
        const tr = trDoItem(itens[i], por);
        tbody.appendChild(tr);
        if (estourou()) {
          tbody.removeChild(tr);
          if (postas === 0 && usados === 1) { tbody.appendChild(tr); i++; postas++; }
          break;
        }
        i++; postas++;
      }

      if (!itens.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-vazio">Linha sem ocupação registrada.</td></tr>';
        break;
      }
      continuacao = true;
    } while (i < itens.length && ++voltas < 60);
  }

  const pgs = [...raiz.querySelectorAll('.pg')];
  pgs.forEach((p, i) => { p.querySelector('.pg-num').textContent = `${i + 1}/${pgs.length}`; });
  return pgs.length;
}

/* Tabelas prontas (o saldo mapeado), sem quebra dentro de cada uma. */
function paginarBlocos(raiz, blocos, titulo, sub) {
  raiz.innerHTML = '';
  let pagina, corpo;
  const abrir = () => {
    pagina = novaPagina(titulo, sub, 0);
    raiz.appendChild(pagina);
    corpo = pagina.querySelector('.pg-corpo');
  };
  abrir();
  for (const b of blocos) {
    corpo.appendChild(b);
    if (corpo.scrollHeight > corpo.clientHeight + 1 && corpo.children.length > 1) {
      corpo.removeChild(b);
      abrir();
      corpo.appendChild(b);
    }
  }
  const pgs = [...raiz.querySelectorAll('.pg')];
  pgs.forEach((p, i) => { p.querySelector('.pg-num').textContent = `${i + 1}/${pgs.length}`; });
  return pgs.length;
}

/* ═══════════ DISPARO ═══════════ */
function dispararImpressao(paginas) {
  document.getElementById('estilo-pagina')?.remove();
  const st = document.createElement('style');
  st.id = 'estilo-pagina';
  st.textContent = '@page { size: A4 portrait; margin: 10mm; }';
  document.head.appendChild(st);

  const limpar = () => {
    st.remove();
    caixaImpressao().innerHTML = '';
    window.removeEventListener('afterprint', limpar);
  };
  window.addEventListener('afterprint', limpar);

  if (typeof toast === 'function') {
    toast(paginas === 1 ? 'Espelho de 1 página.' : `Espelho de ${paginas} páginas.`);
  }
  setTimeout(() => window.print(), 60);
}

/* Atalho da linha: o botãozinho de imprimir dentro de cada bloco. */
function imprimirLinha(di, ln, pav) {
  const alvo = alvoDaLinha(di, ln, pav);
  if (!alvo.posicoes.length) return;
  const n = paginarLinhas(caixaImpressao(), [alvo], 'Espelho do drive-in',
                          `${nomeDoPavilhao(alvo.pav)} · linha ${di}-${ln}`, 1);
  dispararImpressao(n);
}

function imprimirTabela(blocos, titulo, sub) {
  const n = paginarBlocos(caixaImpressao(), blocos, titulo, sub);
  dispararImpressao(n);
}

/* ═══════════ DIÁLOGO ═══════════ */
function montarDialogo() {
  if (document.getElementById('modal-imp')) return;
  const d = document.createElement('div');
  d.className = 'imp-modal';
  d.id = 'modal-imp';
  d.hidden = true;
  d.innerHTML = `
    <div class="imp-cx" role="dialog" aria-labelledby="imp-tit">
      <div class="imp-topo">
        <b id="imp-tit">Espelho para imprimir</b>
        <button class="imp-x" id="imp-x" aria-label="Fechar">✕</button>
      </div>
      <div class="imp-corpo">
        <label class="imp-campo">
          <span>Quais linhas</span>
          <input type="text" id="imp-linhas" autocomplete="off" placeholder="vazio = o que está na tela">
          <small>Aceita <code>B1-01</code>, <code>01</code> (todos os drive-ins),
          <code>B1</code> (o drive-in inteiro) e faixas com dois pontos:
          <code>B1-01..14</code>. Separe por vírgula.</small>
        </label>
        <label class="imp-campo">
          <span>Linhas por página</span>
          <div class="imp-seg" id="imp-por">
            <button type="button" class="on" data-por="1">1</button>
            <button type="button" data-por="2">2</button>
            <button type="button" data-por="4">4</button>
          </div>
        </label>
        <small style="display:block;margin:-8px 0 14px;font-size:.6875rem;color:var(--text-3,#888)">Com 1 ou 2 linhas por página sai o código de barras do produto e do lote; com 4, só o texto.</small>
        <label class="imp-chk"><input type="checkbox" id="imp-vazias">
          <span>Incluir linhas sem nenhuma ocupação</span></label>
        <div class="imp-conta" id="imp-conta"></div>
      </div>
      <div class="imp-pe">
        <button class="imp-bt" id="imp-cancelar">Cancelar</button>
        <button class="imp-bt imp-ok" id="imp-ok">Gerar espelho</button>
      </div>
    </div>`;
  document.body.appendChild(d);

  const fechar = () => { d.hidden = true; };
  d.querySelector('#imp-x').onclick = fechar;
  d.querySelector('#imp-cancelar').onclick = fechar;
  d.onclick = e => { if (e.target === d) fechar(); };
  d.querySelector('#imp-ok').onclick = gerarEspelho;
  d.querySelector('#imp-linhas').oninput = debounce(contarAlvos, 150);
  d.querySelector('#imp-vazias').onchange = contarAlvos;
  d.querySelector('#imp-por').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    d.querySelectorAll('#imp-por button').forEach(x => x.classList.toggle('on', x === b));
    contarAlvos();
  };
}

function alvosEscolhidos() {
  const txt = document.getElementById('imp-linhas').value.trim();
  const { visiveis } = IMP.contexto();
  let alvos = txt ? parseLinhas(txt)
                  : (visiveis || []).map(v => alvoDaLinha(v.di, v.ln, v.pav));
  if (!document.getElementById('imp-vazias').checked) {
    alvos = alvos.filter(a => a.posicoes.some(p => IMP.ocupacaoDe(p).length));
  }
  return alvos;
}

function porPagina() {
  return Number(document.querySelector('#imp-por .on')?.dataset.por || 1);
}

function contarAlvos() {
  const n = alvosEscolhidos().length;
  const pgs = Math.max(1, Math.ceil(n / porPagina()));
  document.getElementById('imp-conta').textContent = n
    ? `${n} linha(s) · pelo menos ${pgs} página(s) em A4 vertical`
    : 'Nenhuma linha bate com isso.';
  document.getElementById('imp-ok').disabled = !n;
}

function abrirDialogoImpressao() {
  montarDialogo();
  const el = document.getElementById('modal-imp');
  el.hidden = false;
  contarAlvos();
  setTimeout(() => document.getElementById('imp-linhas').focus(), 50);
}

function gerarEspelho() {
  const alvos = alvosEscolhidos();
  if (!alvos.length) { toast?.('Nenhuma linha para imprimir.', 'err'); return; }
  const ctx = IMP.contexto();
  const sub = `${ctx.pav ? nomeDoPavilhao(ctx.pav) : ''}${ctx.q ? ` · busca “${ctx.q}”` : ''}`;
  const n = paginarLinhas(caixaImpressao(), alvos, 'Espelho do drive-in', sub, porPagina());
  document.getElementById('modal-imp').hidden = true;
  dispararImpressao(n);
}