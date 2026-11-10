/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · INTELIGÊNCIA DO SALDO (tela Hoje)

   Olha cada divergência do Mapa × sistema e diz a CAUSA PROVÁVEL,
   com o grau de certeza, as pistas e a correção em um clique
   (sempre com confirmação, registrada em Alterações e desfazível).

   De onde vêm as pistas:
     _sCalc.lista          as linhas do Mapa × sistema (saldo-mapeado.js)
     _sa.ref               o saldo do ERP lote a lote (saldo-erp.js)
     estoque_ref_mov       o "filme": o que mudou no ERP a cada envio
     alteracoes            o que mudou no mapa (ocupou, expediu, ajustou)
     inteligencia_decisao  o que você fez com cada sugestão — aprende:
                           tipo muito recusado perde certeza, recusada
                           não volta (a não ser que os números mudem)

   Tolerância: saída do ERP e baixa no mapa raramente acontecem na
   mesma hora (o palete desce para a expedição antes de faturar). Por
   isso, até 1 dia útil depois do evento fica em "Aguardando", não
   vira erro.
   ═══════════════════════════════════════════════════════════════ */

const _intel = { mov:null, alt:null, dec:null, erroMov:null, erroDec:null, carregando:null, achados:[], quando:0, filtro:'' };

const INTEL_TIPOS = {
  'lote-digitado':   { rot:'Lote digitado errado',          cor:'neg',  peso:1.2 },
  'produto-trocado': { rot:'Produto trocado',               cor:'neg',  peso:1.2 },
  'codigo-filial':   { rot:'Código de outra filial',        cor:'alt',  peso:1.0 },
  'armazem-erp':     { rot:'Transferência sem o mapa',      cor:'alt',  peso:1.1 },
  'armazem':         { rot:'Armazém diferente',             cor:'alt',  peso:1.0 },
  'saiu-nao-baixou': { rot:'Saiu e não foi baixado',        cor:'warn', peso:1.3 },
  'sobra':           { rot:'Sobra no mapa',                 cor:'warn', peso:0.9 },
  'erp-nao-baixou':  { rot:'Saiu do mapa, ERP não baixou',  cor:'info', peso:1.0 },
  'producao-nova':   { rot:'Entrou e não foi mapeado',      cor:'info', peso:1.0 },
  'empenhado':       { rot:'Pode estar separado',           cor:'info', peso:0.6 },
  'fefo':            { rot:'FEFO',                          cor:'warn', peso:0.8 },
  'regra-validade':  { rot:'Armazém × validade',            cor:'neg',  peso:0.7 },
  'palete-acima':    { rot:'Palete acima do máximo',        cor:'warn', peso:0.8 },
  'parado':          { rot:'Parado ocupando vaga',          cor:'mute', peso:0.5 },
};
const INTEL_COR = { neg:'t-neg', warn:'t-warn', info:'t-info', alt:'t-alt', pos:'t-ok', mute:'t-mute' };

/* ═══════════ UTILITÁRIOS ═══════════ */
const iKc = (cod, lote) => `${chave(normalizarCodigo(cod))}|${chave(lote)}`;
const iTs = x => x ? new Date(x).getTime() : 0;
const iQ  = (n, un) => `${num(Math.round((Number(n) || 0) * 1000) / 1000)}${un ? ' ' + esc(un) : ''}`;
const iPerto = (a, b, tol = 0.02) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * tol);

// Um dia útil depois de ts (sábado e domingo não contam).
function iMaisUmDiaUtil(ts) {
  const d = new Date(ts);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.getTime();
}
const iPassouTolerancia = ts => Date.now() >= iMaisUmDiaUtil(ts);

function iLev(a, b) {
  const x = String(a || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const y = String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!x || !y) return 99;
  if (Math.abs(x.length - y.length) > 4) return 99;
  let p = Array.from({ length:y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const c = [i];
    for (let j = 1; j <= y.length; j++) c[j] = Math.min(p[j] + 1, c[j-1] + 1, p[j-1] + (x[i-1] === y[j-1] ? 0 : 1));
    p = c;
  }
  return p[y.length];
}

/* ═══════════ DADOS ═══════════ */
async function intelCarregarDados(forcar = false) {
  if (_intel.carregando) return _intel.carregando;
  if (!forcar && _intel.mov && Date.now() - _intel.quando < 120000) return;
  _intel.carregando = (async () => {
    const desde = new Date(Date.now() - 45 * 864e5).toISOString();
    const desdeDec = new Date(Date.now() - 180 * 864e5).toISOString();
    const tenta = p => p.then(d => ({ d }), e => ({ e }));
    const [mov, alt, dec] = await Promise.all([
      tenta(buscarTudo(() => sb.from('estoque_ref_mov')
        .select('quando, filial, codigo, lote, armazem, saldo_antes, saldo_depois, delta, tipo').gte('quando', desde).order('quando'))),
      tenta(buscarTudo(() => sb.from('alteracoes')
        .select('quem, acao, posicao, codigo, lote, armazem, qtd_antes, qtd_depois, created_at').gte('created_at', desde).order('created_at'))),
      tenta(buscarTudo(() => sb.from('inteligencia_decisao')
        .select('id, quando, quem, chave, tipo, decisao, ate, detalhes').gte('quando', desdeDec).order('quando'))),
    ]);
    _intel.erroMov = mov.e || null;
    _intel.erroDec = dec.e || null;
    _intel.mov = mov.e ? [] : mov.d;
    _intel.alt = alt.e ? [] : alt.d;
    _intel.dec = dec.e ? [] : dec.d;
    _intel.quando = Date.now();
    intelIndexar();
  })();
  try { await _intel.carregando; } finally { _intel.carregando = null; }
}

function intelIndexar() {
  const porKa = new Map(), porKc = new Map(), altKc = new Map(), ocupou = new Map();
  for (const m of _intel.mov || []) {
    const kc = iKc(m.codigo, m.lote), ka = `${kc}|${normalizarArmazem(m.armazem)}`;
    (porKa.get(ka) || porKa.set(ka, []).get(ka)).push(m);
    (porKc.get(kc) || porKc.set(kc, []).get(kc)).push(m);
  }
  for (const a of _intel.alt || []) {
    if (!a.codigo) continue;
    const kc = iKc(a.codigo, a.lote);
    (altKc.get(kc) || altKc.set(kc, []).get(kc)).push(a);
    if (a.acao === 'ocupou' && a.posicao) ocupou.set(`${a.posicao}|${kc}`, a);
  }
  // decisões: a última por chave + contagem por tipo (aprendizado)
  const ultima = new Map(), porTipo = {};
  for (const d of _intel.dec || []) {
    ultima.set(d.chave, d);
    const t = porTipo[d.tipo] ||= { a:0, r:0 };
    if (d.decisao === 'aplicou') t.a++;
    if (d.decisao === 'recusou') t.r++;
  }
  Object.assign(_intel, { porKa, porKc, altKc, ocupou, ultima, porTipo });
}

// Tipo que você costuma recusar perde certeza; o que aceita, mantém.
function intelFator(tipo) {
  const t = _intel.porTipo?.[tipo];
  if (!t) return 1;
  return 0.5 + 0.5 * (t.a + 3) / (t.a + t.r + 3);
}

/* Quem pôs o item na vaga (pela trilha de alterações). */
function intelQuemMapeou(l) {
  const nomes = new Set();
  for (const r of l.itens || []) {
    const a = _intel.ocupou?.get(`${r.pos}|${l.kc}`);
    if (a?.quem) nomes.add(a.quem);
  }
  return [...nomes];
}

/* ═══════════ DETETIVE: uma linha do Mapa × sistema ═══════════ */
function intelLinhasPorK() {
  if (_intel._calc === _sCalc && _intel._porK) return _intel._porK;
  _intel._calc = _sCalc;
  _intel._porK = new Map((_sCalc?.lista || []).map(l => [l.k, l]));
  return _intel._porK;
}

function intelAnalisarLinha(l) {
  if (!l || l.estado === 'ok') return null;
  const un = l.un || '';
  const armM = l.armsMapa[0] || '';
  const base = (tipo, conf, titulo, txt, extra = {}) => ({
    tipo, conf:Math.max(5, Math.min(98, Math.round(conf * intelFator(tipo)))), titulo, txt, l,
    pistas:[], acoes:[], grupo:'arrumar', quando:null, ...extra,
  });
  const quem = intelQuemMapeou(l);
  const pistaQuem = quem.length ? `Mapeado por <b>${quem.map(esc).join(', ')}</b>.` : '';
  const vagas = [...l.vagas].sort();
  const vagasTxt = vagas.length ? `${vagas.slice(0, 4).map(esc).join(', ')}${vagas.length > 4 ? ` +${vagas.length - 4}` : ''}` : '';

  // ── produto trocado / código de outra filial: o cálculo já casou ──
  if (l.estado === 'produto') {
    const a = base('produto-trocado', 92, `Produto errado na vaga`,
      `No mapa está <b>${esc(l.prodMapa)}</b>; no ERP o lote <b>${esc(l.lote)}</b> no ${esc(l.armsSis.join(', '))} com a mesma quantidade é de <b>${esc(l.prodSis)}</b>.`);
    a.pistas.push('Mesmo lote, mesmo armazém e mesma quantidade.');
    if (pistaQuem) a.pistas.push(pistaQuem);
    a.acoes.push({ rot:`Trocar para ${nomeCurtoSaldo(l.prodSis)}`, op:'campo', campo:'codigo', novo:l.codSis, primaria:true });
    return a;
  }
  if (l.estado === 'codigo') {
    const bate = iPerto(l.mapa, l.sistema || 0);
    const a = base('codigo-filial', bate ? 95 : 85, `Código da filial errada`,
      `No mapa está o código <b>${esc(l.codMapa)}</b>; no ERP este lote é do <b>${esc(l.codSis)}</b> — mesmo produto, outra filial.`);
    a.pistas.push(bate ? 'A quantidade bate.' : `Depois de trocar ainda fica ${iQ(l.mapa - (l.sistema || 0), un)} de diferença.`);
    if (pistaQuem) a.pistas.push(pistaQuem);
    a.acoes.push({ rot:`Trocar o código para ${l.codSis}`, op:'campo', campo:'codigo', novo:l.codSis, primaria:true });
    return a;
  }

  // ── armazém trocado: o ERP transferiu e o mapa não acompanhou? ──
  if (l.estado === 'armazem') {
    const desdeMapa = Math.min(...l.itens.map(r => iTs(r.created_at)).filter(Boolean), Date.now());
    let prova = null;
    for (const aS of l.armsSis) {
      const ent = (_intel.porKa?.get(`${l.kc}|${aS}`) || []).filter(m => m.delta > 0 && iTs(m.quando) >= desdeMapa - 864e5);
      const sai = (_intel.porKa?.get(`${l.kc}|${armM}`) || []).filter(m => m.delta < 0);
      const par = ent.find(e => sai.some(s => Math.abs(iTs(s.quando) - iTs(e.quando)) < 3 * 3600e3 && iPerto(-s.delta, e.delta, 0.05)));
      if (par) { prova = { para:aS, quando:par.quando, qtd:par.delta }; break; }
    }
    const destino = l.armsSis.length === 1 ? l.armsSis[0] : null;
    if (prova) {
      const a = base('armazem-erp', 95, `Transferido no ERP, o mapa ficou no ${esc(armM)}`,
        `Em <b>${fmtTS(prova.quando)}</b> o ERP tirou ${iQ(prova.qtd, un)} do <b>${esc(armM)}</b> e pôs no <b>${esc(prova.para)}</b>. O mapa continua com ${esc(armM)} nas vagas ${vagasTxt}.`,
        { quando:prova.quando });
      a.pistas.push('A saída de um armazém e a entrada no outro aconteceram juntas, com a mesma quantidade.');
      if (destino) a.acoes.push({ rot:`Mudar o mapa para ${destino}`, op:'campo', campo:'armazem', novo:destino, primaria:true });
      return a;
    }
    const bate = iPerto(l.mapa, l.sistema || 0);
    const a = base('armazem', bate ? 78 : 62, `Armazém diferente: mapa ${esc(l.armsMapa.join(', '))}, ERP ${esc(l.armsSis.join(', '))}`,
      `O mesmo lote está no mapa como <b>${esc(l.armsMapa.join(', '))}</b> e no ERP como <b>${esc(l.armsSis.map(x => x + (nomeArmazem(x) ? ' (' + nomeArmazem(x) + ')' : '')).join(', '))}</b>. Ou o mapa foi preenchido errado, ou falta a transferência no ERP.`);
    a.pistas.push(bate ? 'A quantidade bate.' : `Quantidade: mapa ${iQ(l.mapa, un)}, ERP ${iQ(l.sistema, un)}.`);
    if (pistaQuem) a.pistas.push(pistaQuem);
    if (destino) a.acoes.push({ rot:`Mudar o mapa para ${destino}`, op:'campo', campo:'armazem', novo:destino, primaria:true });
    a.acoes.push({ rot:'Transferir no ERP', op:'transferencia' });
    return a;
  }

  // ── lote não existe: procura o lote certo ──
  if (l.estado === 'lote') {
    const cand = intelMelhorLote(l);
    if (cand && cand.conf >= 45) {
      const a = base('lote-digitado', cand.conf, `Lote digitado errado: o certo deve ser ${esc(cand.lote)}`,
        `No mapa está <b>${esc(l.lote)}</b> (${iQ(l.mapa, un)} em ${vagasTxt}). Esse lote não existe para este produto. O ERP tem <b>${esc(cand.lote)}</b> no ${esc(cand.arm)} com ${iQ(cand.saldo, un)}${cand.falta < cand.saldo - 0.001 ? `, dos quais ${iQ(cand.falta, un)} ainda sem vaga` : ' e nada dele no mapa'}.`);
      a.pistas.push(...cand.pistas);
      if (pistaQuem) a.pistas.push(pistaQuem);
      a.acoes.push({ rot:`Trocar o lote para ${cand.lote}`, op:'campo', campo:'lote', novo:cand.lote, primaria:true });
      a.acoes.push({ rot:'Pedir recontagem', op:'recontagem' });
      return a;
    }
  }

  // ── mapa tem mais do que o ERP (inclui lote sem par e sem saldo) ──
  const sobraQ = l.mapa - Math.max(0, l.sistema || 0);
  if (sobraQ > 0.001 && (l.estado === 'sobra' || l.estado === 'lote' || l.estado === 'sem-saldo')) {
    const desdeMapa = Math.min(...l.itens.map(r => iTs(r.created_at)).filter(Boolean), Date.now());
    const saidas = l.armsMapa.flatMap(a => _intel.porKa?.get(`${l.kc}|${a}`) || []).filter(m => m.delta < 0 && iTs(m.quando) >= desdeMapa - 864e5);
    const somaSai = saidas.reduce((s, m) => s - m.delta, 0);
    const baixavel = l.itens.filter(r => !r.sep).reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
    const separado = l.itens.some(r => r.sep);
    if (saidas.length) {
      const ult = saidas[saidas.length - 1].quando;
      const qtdB = Math.min(sobraQ, somaSai, baixavel);
      const dentro = !iPassouTolerancia(iTs(ult));
      const a = base('saiu-nao-baixou', iPerto(somaSai, sobraQ, 0.05) ? 92 : 78,
        dentro ? `Saiu no ERP ${haQuanto(iTs(ult))}, esperando baixar no mapa` : `Saiu no ERP e continua no mapa`,
        `O ERP baixou ${iQ(somaSai, un)} deste lote no ${esc(l.armsMapa.join(', '))} (última em <b>${fmtTS(ult)}</b>). O mapa continua com ${iQ(l.mapa, un)} em ${vagasTxt}${l.sistema ? `, e o ERP tem ${iQ(l.sistema, un)}` : ''}.`,
        { quando:ult, grupo:dentro ? 'aguardando' : 'arrumar' });
      a.pistas.push(iPerto(somaSai, sobraQ, 0.05) ? 'A quantidade que saiu no ERP é a mesma que sobra no mapa.' : `Sobra no mapa ${iQ(sobraQ, un)}; saiu no ERP ${iQ(somaSai, un)}.`);
      if (separado) a.pistas.push('Parte está na área de separação — expedir por lá (mapa → Pedidos separados).');
      if (dentro) a.pistas.push(`Vira tarefa ${fmtTS(new Date(iMaisUmDiaUtil(iTs(ult))).toISOString())} se ninguém baixar.`);
      if (qtdB > 0.001) a.acoes.push({ rot:`Baixar ${num(Math.round(qtdB * 1000) / 1000)} ${un} do mapa`, op:'baixar', qtd:qtdB, primaria:true });
      a.acoes.push({ rot:'Pedir recontagem', op:'recontagem' });
      return a;
    }
    // Sem pista no filme.
    const nunca = l.sistema === null || l.sistema === 0;
    const histIni = _sa?.inicioHist;
    const antes = histIni && desdeMapa < new Date(histIni).getTime();
    const a = base('sobra', nunca ? (antes ? 60 : 50) : 45,
      nunca ? `Sem saldo no ERP neste armazém` : `Mapa com ${iQ(sobraQ, un)} a mais`,
      nunca
        ? `O mapa tem ${iQ(l.mapa, un)} em ${vagasTxt}, mas o ERP não tem este lote no ${esc(l.armsMapa.join(', '))}.${antes ? ' Foi mapeado antes de o histórico começar: a saída pode ter sido antes disso.' : ''}`
        : `Mapa ${iQ(l.mapa, un)}, ERP ${iQ(l.sistema, un)}. Não achei saída no ERP que explique.`);
    for (const d of (l.dicas || []).slice(0, 2)) a.pistas.push(d.t);
    if (pistaQuem) a.pistas.push(pistaQuem);
    a.acoes.push({ rot:'Pedir recontagem', op:'recontagem', primaria:true });
    if (nunca && baixavel > 0.001) a.acoes.push({ rot:`Baixar ${num(Math.round(Math.min(sobraQ, baixavel) * 1000) / 1000)} ${un} do mapa`, op:'baixar', qtd:Math.min(sobraQ, baixavel) });
    return a;
  }

  // ── ERP tem mais do que o mapa ──
  const faltaQ = (l.sistema || 0) - l.mapa;
  if (faltaQ > 0.001 && (l.estado === 'falta' || l.estado === 'nao-mapeado')) {
    // A) saiu do mapa (expediu) e o ERP ainda não baixou
    const exps = (_intel.altKc?.get(l.kc) || []).filter(x => x.acao === 'expediu' && (!x.armazem || l.armsSis.includes(normalizarArmazem(x.armazem))));
    const qtdExp = exps.reduce((s, x) => s + Math.max(0, (Number(x.qtd_antes) || 0) - (Number(x.qtd_depois) || 0)), 0);
    if (exps.length && qtdExp > 0.001) {
      const ult = exps[exps.length - 1].created_at;
      const saiuDepois = l.armsSis.flatMap(a => _intel.porKa?.get(`${l.kc}|${a}`) || []).some(m => m.delta < 0 && iTs(m.quando) > iTs(ult));
      if (!saiuDepois) {
        const dentro = !iPassouTolerancia(iTs(ult));
        const a = base('erp-nao-baixou', iPerto(qtdExp, faltaQ, 0.05) ? 88 : 70,
          dentro ? `Expedido ${haQuanto(iTs(ult))}, esperando o ERP faturar` : `Saiu do mapa e o ERP não baixou`,
          `Em <b>${fmtTS(ult)}</b> saiu ${iQ(qtdExp, un)} deste lote do mapa (por ${esc([...new Set(exps.map(x => x.quem).filter(Boolean))].join(', ') || '—')}). O ERP ainda tem ${iQ(l.sistema, un)} no ${esc(l.armsSis.join(', '))}.`,
          { quando:ult, grupo:dentro ? 'aguardando' : 'arrumar' });
        a.pistas.push(iPerto(qtdExp, faltaQ, 0.05) ? 'A quantidade expedida é a mesma que falta no mapa.' : `Falta no mapa ${iQ(faltaQ, un)}; expedido ${iQ(qtdExp, un)}.`);
        if (!dentro) a.pistas.push('Confira com o faturamento se a nota saiu. Se o palete não saiu de verdade, ele voltou para o drive sem ser mapeado.');
        a.acoes.push({ rot:'Pedir recontagem', op:'recontagem', primaria:!dentro });
        return a;
      }
    }
    // B) entrou no ERP e ninguém mapeou
    const ents = l.armsSis.flatMap(a => _intel.porKa?.get(`${l.kc}|${a}`) || []).filter(m => m.delta > 0);
    const somaEnt = ents.reduce((s, m) => s + m.delta, 0);
    if (ents.length && somaEnt >= faltaQ * 0.5) {
      const ult = ents[ents.length - 1].quando;
      const dentro = !iPassouTolerancia(iTs(ult));
      const a = base('producao-nova', iPerto(somaEnt, faltaQ, 0.05) ? 85 : 70,
        dentro ? `Entrou no ERP ${haQuanto(iTs(ult))}, ainda sem vaga` : `Entrou no ERP e ninguém mapeou`,
        `Em <b>${fmtTS(ult)}</b> entrou ${iQ(somaEnt, un)} deste lote no ${esc(l.armsSis.join(', '))}. Falta mapear ${iQ(faltaQ, un)}.`,
        { quando:ult, grupo:dentro ? 'aguardando' : 'arrumar' });
      a.acoes.push({ rot:'Abrir o mapa', op:'mapa', primaria:!dentro });
      a.acoes.push({ rot:'Pedir recontagem', op:'recontagem' });
      return a;
    }
    // C) empenhado: pode estar separado fora do drive
    if (l.empenho > 0 && l.empenho >= faltaQ * 0.98) {
      const a = base('empenhado', 60, `Falta ${iQ(faltaQ, un)} no mapa, mas está empenhado`,
        `O ERP tem ${iQ(l.empenho, un)} empenhado deste lote — pode já estar separado para um pedido, fora do drive.`,
        { grupo:'semPista' });
      a.acoes.push({ rot:'Pedir recontagem', op:'recontagem' });
      return a;
    }
    // D) sem pista: falta mapear
    return base('producao-nova', 30, `Falta mapear ${iQ(faltaQ, un)}`, `Sem movimento recente no ERP que explique.`, { grupo:'semPista' });
  }
  return null;
}

/* O lote certo para um "lote não existe": mesmo produto, lote
   parecido, de preferência no mesmo armazém e com a quantidade que
   falta mapear batendo. */
function intelMelhorLote(l) {
  const porK = intelLinhasPorK();
  const cod = normalizarCodigo(l.cod);
  const cands = (_sa?.ref || []).filter(r => normalizarCodigo(r.cod) === cod && r.saldo > 0 && chave(r.lote) !== chave(l.lote));
  const res = [];
  for (const c of cands) {
    const d = iLev(c.lote, l.lote);
    const contem = lotesParecidos(c.lote, l.lote);
    if (d > 3 && !contem) continue;
    const linhaC = porK.get(`${iKc(c.cod, c.lote)}|${c.arm}`);
    const falta = linhaC ? Math.max(0, (linhaC.sistema || 0) - linhaC.mapa) : c.saldo;
    let s = 0; const pistas = [];
    if (d === 1) { s += 30; pistas.push(`Lote a 1 caractere de distância (${esc(l.lote)} × ${esc(c.lote)}).`); }
    else if (d === 2) { s += 18; pistas.push(`Lote a 2 caracteres de distância.`); }
    else if (contem) { s += 14; pistas.push('Um lote contém o outro.'); }
    if (l.armsMapa.includes(c.arm)) { s += 20; pistas.push(`Mesmo armazém (${esc(c.arm)}).`); }
    if (falta > 0.001) {
      if (iPerto(l.mapa, falta, 0.02)) { s += 35; pistas.push(`A quantidade sem vaga do ${esc(c.lote)} (${iQ(falta, l.un)}) é a mesma do mapa.`); }
      else if (iPerto(l.mapa, falta, 0.1)) { s += 20; pistas.push(`Quantidade parecida (${iQ(falta, l.un)} sem vaga × ${iQ(l.mapa, l.un)} no mapa).`); }
      else if (l.mapa < falta) s += 8;
      else s -= 10;
    } else { s -= 25; pistas.push(`Mas o ${esc(c.lote)} já está todo no mapa.`); }
    res.push({ lote:c.lote, arm:c.arm, saldo:c.saldo, falta, conf:30 + s, pistas });
  }
  res.sort((a, b) => b.conf - a.conf);
  if (!res.length) return null;
  const [m, seg] = res;
  if (seg && m.conf - seg.conf < 10) { m.conf -= 15; m.pistas.push(`Outro candidato parecido: ${esc(seg.lote)} — confira a etiqueta.`); }
  m.conf = Math.max(5, Math.min(97, m.conf));
  return m;
}

/* ═══════════ REGRAS DO NEGÓCIO ═══════════ */
function intelRegras() {
  const out = [];
  const ref = (_sa?.ref || []).filter(l => typeof daFilial !== 'function' || daFilial(l.filial));

  // Vencido fora do D7 / D7 sem estar vencido — um cartão por armazém.
  if (typeof SA_REGRAS !== 'undefined') {
    for (const r of SA_REGRAS) {
      const g = new Map();
      for (const l of ref) if (l.saldo > 0 && r.t(l)) (g.get(l.arm) || g.set(l.arm, []).get(l.arm)).push(l);
      for (const [arm, ls] of g) {
        const pl = ls.reduce((s, l) => s + (l.pl || 0), 0);
        out.push({ tipo:'regra-validade', grupo:'regras', conf:100, titulo:`${esc(r.rot)}: ${num(ls.length)} lote(s) no ${esc(arm)}`,
          txt:`${typeof saTxtUn === 'function' ? saTxtUn(ls) : ''}${pl ? ` · ${num1(pl)} palete(s)` : ''}. Regra: lote vencido fica no D7, e o D7 é só para vencido.`,
          pistas:ls.slice(0, 3).map(l => `${esc(l.desc)} · ${esc(l.lote)} · ${iQ(l.saldo, l.un)}`), impactoBase:Math.max(1, pl),
          chaveExtra:`${r.id}|${arm}|${ls.length}`, acoes:[{ rot:'Ver a lista', op:'aba', aba:'armazem', primaria:true }] });
      }
    }
  }

  // Vaga com mais do que cabe num palete.
  for (const [pos, itens] of Object.entries(typeof _sOcup !== 'undefined' && _sOcup || {})) {
    for (const it of itens) {
      if (it.sep) continue;
      const max = Number(produtoPorCodigo(normalizarCodigo(it.codigo))?.palete) || 0;
      const q = Number(it.quantidade) || 0;
      if (!max || q <= max * 1.05) continue;
      const un = unidadeDe(it.codigo, it.produto_nome) || '';
      out.push({ tipo:'palete-acima', grupo:'regras', conf:85, titulo:`${esc(pos)}: ${iQ(q, un)} numa vaga onde cabe ${iQ(max, un)}`,
        txt:`${esc(it.produto_nome || it.codigo)} · lote ${esc(it.lote || '—')}. Ou a quantidade foi digitada errada, ou são ${num1(q / max)} paletes na mesma vaga.`,
        pistas:[], impactoBase:q / max - 1, chaveExtra:`${pos}|${it.id}|${q}`,
        acoes:[{ rot:'Abrir a vaga', op:'vaga', pos, primaria:true }] });
    }
  }

  // FEFO: saiu um lote mais novo enquanto um mais velho do mesmo produto ficou parado.
  if (_intel.porKc?.size) {
    const desde = Date.now() - 30 * 864e5;
    const saiuPorKc = new Map();
    for (const [kc, ms] of _intel.porKc) {
      const liq = ms.filter(m => iTs(m.quando) >= desde).reduce((s, m) => s + Number(m.delta), 0);   // transferência entre armazéns se anula
      if (liq < -0.001) saiuPorKc.set(kc, liq);
    }
    const porProd = new Map();
    for (const l of ref) {
      if (!(l.saldo > 0) || l.dias === null || l.dias < 0 || l.arm === 'D7' || (typeof armMapeado === 'function' && !armMapeado(l.arm))) continue;
      const k = `${l.filial}|${l.cod}`;
      (porProd.get(k) || porProd.set(k, []).get(k)).push(l);
    }
    for (const ls of porProd.values()) {
      const saiu = ls.filter(l => saiuPorKc.has(iKc(l.cod, l.lote)));
      if (!saiu.length) continue;
      for (const s of saiu) {
        const velho = ls.filter(o => o.lote !== s.lote && o.val && s.val && o.val < s.val && (new Date(s.val) - new Date(o.val)) >= 30 * 864e5 && !saiuPorKc.has(iKc(o.cod, o.lote)))
          .sort((a, b) => a.val.localeCompare(b.val))[0];
        if (!velho) continue;
        out.push({ tipo:'fefo', grupo:'regras', conf:70, titulo:`${esc(s.desc)}: saiu o lote ${esc(s.lote)}, mas o ${esc(velho.lote)} vence antes`,
          txt:`Nos últimos 30 dias saiu ${iQ(-saiuPorKc.get(iKc(s.cod, s.lote)), s.un)} do <b>${esc(s.lote)}</b> (vence ${saData(s.val)}), enquanto o <b>${esc(velho.lote)}</b> (vence ${saData(velho.val)}, ${iQ(velho.saldo, velho.un)} no ${esc(velho.arm)}) não saiu nada.`,
          pistas:velho.vagas?.length ? [`O ${esc(velho.lote)} está em ${velho.vagas.slice(0, 4).map(esc).join(', ')}.`] : [],
          impactoBase:Math.max(1, velho.pl || 1), chaveExtra:`${s.cod}|${s.lote}|${velho.lote}`,
          acoes:velho.vagas?.length ? [{ rot:`Ver ${velho.vagas[0]}`, op:'vaga', pos:velho.vagas[0], primaria:true }] : [] });
      }
    }
  }

  // Parado ocupando vaga (sem mexer no ERP há 90+ dias, fora do D7).
  if (typeof saParados === 'function' && _sa?.lotes) {
    for (const p of saParados(ref)) {
      if (p.dias < 90 || p.l.arm === 'D7' || !(p.l.vagas || []).length) continue;
      out.push({ tipo:'parado', grupo:'regras', conf:100, titulo:`${esc(p.l.desc)} · ${esc(p.l.lote)} parado há ${p.desdeInicio ? '≥ ' : ''}${num(p.dias)} dias`,
        txt:`${iQ(p.l.saldo, p.l.un)} no ${esc(p.l.arm)}, ocupando ${p.l.vagas.length} vaga(s): ${p.l.vagas.slice(0, 4).map(esc).join(', ')}.`,
        pistas:[], impactoBase:Math.max(1, p.l.pl || p.l.vagas.length), chaveExtra:`${p.l.k}|${String(p.desde).slice(0, 10)}`,
        acoes:[{ rot:`Ver ${p.l.vagas[0]}`, op:'vaga', pos:p.l.vagas[0], primaria:true }] });
    }
  }
  return out;
}

/* ═══════════ TODOS OS ACHADOS ═══════════ */
function intelChave(a) {
  const l = a.l;
  return l ? `${a.tipo}|${l.k}|${Math.round(l.mapa * 1000) / 1000}|${l.sistema == null ? '-' : Math.round(l.sistema * 1000) / 1000}` : `${a.tipo}|${a.chaveExtra}`;
}
function intelImpacto(a) {
  const peso = INTEL_TIPOS[a.tipo]?.peso || 1;
  let pl = a.impactoBase;
  if (pl == null && a.l) {
    const q = Math.max(a.l.mapa, a.l.sistema || 0, Math.abs(a.l.dif || 0));
    pl = a.l.palete ? q / a.l.palete : Math.max(1, a.l.vagas?.size || 1);
  }
  return Math.max(0.3, pl || 1) * (a.conf / 100) * peso;
}
function intelCalcular() {
  const lista = (_sCalc?.lista || []).filter(l => l.estado !== 'ok');
  const out = [];
  for (const l of lista) { const a = intelAnalisarLinha(l); if (a) out.push(a); }
  out.push(...intelRegras());
  const agora = Date.now();
  for (const a of out) {
    a.id = intelChave(a);
    a.impacto = intelImpacto(a);
    const d = _intel.ultima?.get(a.id);
    a.decisao = d || null;
    a.oculto = !!d && (d.decisao === 'recusou' || d.decisao === 'aplicou' || (d.decisao === 'adiou' && iTs(d.ate) > agora));
  }
  out.sort((a, b) => b.impacto - a.impacto);
  _intel.achados = out;
  return out;
}

/* ═══════════ VEREDITO no detalhe do Mapa × sistema e da Planilha ═══════════ */
function intelVereditoHTML(l) {
  if (!l || l.estado === 'ok') return '';
  if (!_intel.mov && !_intel.carregando) {
    intelCarregarDados().then(() => {
      if ($('page-saldo')?.classList.contains('active')) { renderSaldo?.(); renderSaldoErp?.(); }
    }).catch(() => {});
  }
  const a = intelAnalisarLinha(l);
  if (!a || a.grupo === 'semPista' && a.conf < 40) return '';
  a.id = intelChave(a);
  _intel.soltos ||= new Map();
  _intel.soltos.set(a.id, a);
  const t = INTEL_TIPOS[a.tipo] || {};
  return `<div class="iv iv-${t.cor || 'mute'}" onclick="event.stopPropagation()">
    <div class="iv-cab"><span class="iv-rot">Causa provável</span>${intelConfHTML(a.conf)}</div>
    <div class="iv-tit">${a.titulo}</div>
    <div class="iv-txt">${a.txt}</div>
    ${a.pistas.length ? `<ul class="iv-pistas">${a.pistas.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
    ${a.acoes.length ? `<div class="iv-acoes">${a.acoes.map((x, i) => `<button class="btn btn-sm${x.primaria ? ' btn-primary' : ''}" onclick="intelAcao('${intelAttr(a.id)}', ${i})">${esc(x.rot)}</button>`).join('')}
      <button class="btn btn-sm btn-ghost" onclick="intelRecusar('${intelAttr(a.id)}')" title="Não é isso — não sugerir de novo enquanto os números forem os mesmos">Não é isso</button></div>` : ''}
  </div>`;
}
function intelConfHTML(c) {
  const n = c >= 85 ? 'alta' : c >= 60 ? 'media' : 'baixa';
  return `<span class="iv-conf c-${n}" title="Quanto o sistema tem certeza desta causa"><i><u style="width:${c}%"></u></i><b>${c}%</b> de certeza</span>`;
}
const intelAttr = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
function intelAchado(id) {
  return _intel.achados.find(a => a.id === id) || _intel.soltos?.get(id) || null;
}

/* ═══════════ AÇÕES ═══════════ */
async function intelAcao(id, i) {
  const a = intelAchado(id), x = a?.acoes[i];
  if (!x) return;
  if (x.op === 'campo')        return intelCorrigirCampo(a, x);
  if (x.op === 'baixar')       return intelBaixar(a, x);
  if (x.op === 'recontagem')   return intelRecontagem(a);
  if (x.op === 'transferencia') return intelTransferencia(a);
  if (x.op === 'vaga')         return irParaVaga(x.pos);
  if (x.op === 'mapa')         return irPara('mapa');
  if (x.op === 'aba')          { irPara('saldo'); saAba(x.aba); return; }
}

async function intelRegistrar(a, decisao, detalhes = {}, ate = null) {
  try {
    const { error } = await sb.from('inteligencia_decisao').insert({
      quem:QUEM || USUARIO?.nome || null, chave:a.id, tipo:a.tipo, decisao, ate,
      detalhes:{ titulo:String(a.titulo || '').replace(/<[^>]+>/g, ''), conf:a.conf, lote:a.l?.lote, codigo:a.l?.cod,
                 armazem:a.l?.armsMapa?.[0] || a.l?.armsSis?.[0] || null, quemMapeou:a.l ? intelQuemMapeou(a.l) : [], ...detalhes },
    });
    if (error) throw error;
    return true;
  } catch (e) {
    if (/inteligencia_decisao/.test(e?.message || '')) toast('Rode o sql/migracao-inteligencia.sql no Supabase para o sistema lembrar das decisões.', 'warn', 7000);
    else console.warn('decisão não registrada:', e?.message);
    return false;
  }
}

async function intelDepois() {
  _intel.quando = 0;
  await carregarSaldoMapa(true);
  if (typeof cacheInvalidar === 'function') cacheInvalidar('saldo-erp');
  await intelCarregarDados(true);
  if ($('page-hoje')?.classList.contains('active')) { intelCalcular(); renderHoje(); }
  else if ($('page-saldo')?.classList.contains('active')) { renderSaldoErp?.(); }
  intelContador();
}

async function intelCorrigirCampo(a, x) {
  const l = a.l;
  const itens = l.itens.filter(r => !r.sep || x.campo !== 'armazem');
  if (!itens.length) return;
  const rot = x.campo === 'lote' ? 'lote' : x.campo === 'codigo' ? 'código' : 'armazém';
  const novo = x.campo === 'armazem' ? normalizarArmazem(x.novo) : x.novo;
  if (!confirm(`${String(a.titulo).replace(/<[^>]+>/g, '')}\n\nTrocar o ${rot} de ${itens.length} item(ns) do mapa (${itens.map(r => r.pos).sort().join(', ')}) para ${novo}?\n\nFica em Alterações e dá para desfazer na tela Hoje.`)) return;
  const mudancas = [];
  try {
    for (const r of itens) {
      const tab = r._tab || 'historico';
      const antes = x.campo === 'codigo' ? { codigo:r.codigo, produto_nome:r.produto_nome, filial:r.filial ?? null } : { [x.campo]:r[x.campo] ?? null };
      const patch = x.campo === 'codigo'
        ? { codigo:novo, produto_nome:produtoPorCodigo(novo)?.nome || r.produto_nome, filial:codigoFilialDoProduto(novo) || r.filial }
        : { [x.campo]:novo };
      await atualizarResiliente(tab, { ...patch, updated_at:new Date().toISOString() }, q => q.eq('id', r.id));
      mudancas.push({ tab, id:r.id, pos:r.pos, antes, depois:patch, qtd:r.quantidade });
      await registrarAlteracao({
        acao:'ajustou', posicao:r.pos, codigo:patch.codigo || r.codigo, produto_nome:patch.produto_nome || r.produto_nome,
        lote:patch.lote || r.lote, armazem:patch.armazem || r.armazem, qtd_antes:r.quantidade, qtd_depois:r.quantidade,
        tabela_ref:tab, ref_id:r.id, obs:`${rot} ${antes[x.campo] ?? antes.codigo ?? 'vazio'} → ${novo} (Hoje · ${INTEL_TIPOS[a.tipo]?.rot || a.tipo})`,
      });
    }
    await intelRegistrar(a, 'aplicou', { acao:x.rot, mudancas });
    toast(`${rot[0].toUpperCase() + rot.slice(1)} corrigido em ${mudancas.length} item(ns).`, 'ok', 4500);
  } catch (e) {
    if (mudancas.length) await intelRegistrar(a, 'aplicou', { acao:x.rot + ' (parcial)', mudancas });
    erro('Não consegui corrigir tudo', e);
  }
  await intelDepois();
}

/* Baixa a quantidade das vagas: primeiro uma vaga com exatamente essa
   quantidade; senão, das maiores para as menores (a última pode ficar
   com o resto). Área de separação fica de fora — expede por lá. */
function intelPlanoBaixa(itens, qtd) {
  const vs = itens.filter(r => !r.sep && (Number(r.quantidade) || 0) > 0);
  const exata = vs.find(r => iPerto(Number(r.quantidade), qtd, 0.001));
  if (exata) return [{ r:exata, sai:Number(exata.quantidade) }];
  const plano = []; let resta = qtd;
  for (const r of [...vs].sort((a, b) => b.quantidade - a.quantidade)) {
    if (resta <= 0.001) break;
    const sai = Math.min(resta, Number(r.quantidade));
    plano.push({ r, sai }); resta -= sai;
  }
  return plano;
}
async function intelBaixar(a, x) {
  const l = a.l, un = l.un || '';
  const plano = intelPlanoBaixa(l.itens, x.qtd);
  if (!plano.length) return;
  const txt = plano.map(p => `  ${p.r.pos}: ${num(p.r.quantidade)} → ${num(Math.round((p.r.quantidade - p.sai) * 1000) / 1000)} ${un}`).join('\n');
  if (!confirm(`${String(a.titulo).replace(/<[^>]+>/g, '')}\n\nBaixar ${num(Math.round(x.qtd * 1000) / 1000)} ${un} de ${l.produto} · lote ${l.lote}:\n${txt}\n\nFica em Alterações e dá para desfazer na tela Hoje.`)) return;
  const mudancas = [];
  try {
    for (const { r, sai } of plano) {
      const tab = r._tab || 'historico', disp = Number(r.quantidade) || 0, restou = Math.round((disp - sai) * 1000) / 1000;
      const patch = restou > 0.001 ? { quantidade:restou } : { ocupacao_ativa:false };
      await atualizarResiliente(tab, { ...patch, updated_at:new Date().toISOString(), feito_por:QUEM }, q => q.eq('id', r.id));
      mudancas.push({ tab, id:r.id, pos:r.pos, antes:{ quantidade:disp, ocupacao_ativa:true }, depois:patch });
      await registrarAlteracao({
        acao:'expediu', posicao:r.pos, codigo:r.codigo, produto_nome:r.produto_nome, lote:r.lote, armazem:r.armazem,
        qtd_antes:disp, qtd_depois:restou > 0.001 ? restou : 0, tabela_ref:tab, ref_id:r.id,
        obs:`saiu ${num(sai)} ${un} (Hoje · ${INTEL_TIPOS[a.tipo]?.rot || a.tipo})`,
      });
    }
    await intelRegistrar(a, 'aplicou', { acao:x.rot, mudancas });
    toast(`Baixado ${num(Math.round(x.qtd * 1000) / 1000)} ${un} de ${plano.length} vaga(s).`, 'ok', 4500);
  } catch (e) {
    if (mudancas.length) await intelRegistrar(a, 'aplicou', { acao:x.rot + ' (parcial)', mudancas });
    erro('Não consegui baixar tudo', e);
  }
  await intelDepois();
}

async function intelRecontagem(a) {
  const l = a.l;
  if (!l) return;
  const arm = l.armsSis[0] || l.armsMapa[0] || null;
  if (!confirm(`Pedir recontagem de ${l.produto} · lote ${l.lote} · armazém ${arm || '—'}?\n\nAparece no celular dos conferentes.`)) return;
  try {
    await inserirResiliente('recontagens', {
      ciclo_id:typeof _ciclo !== 'undefined' ? _ciclo?.id ?? null : null, codigo:normalizarCodigo(l.cod), produto_nome:l.produto,
      lote:l.lote, armazem:arm, filial:l.filial ? (FILIAIS.find(f => f.slug === l.filial)?.codigos[0] || l.filial) : null,
      posicoes:[...l.vagas].sort().join(', ') || null, contagem_anterior:l.mapa, status:'aberta',
      motivo:`Hoje: ${String(a.titulo).replace(/<[^>]+>/g, '')}`,
      solicitado_por:(typeof GESTOR !== 'undefined' && GESTOR) || QUEM || 'painel', solicitado_em:new Date().toISOString(),
    });
    await intelRegistrar(a, 'adiou', { acao:'Pedir recontagem' }, new Date(iMaisUmDiaUtil(Date.now())).toISOString());
    toast(`Recontagem pedida: ${l.produto} · lote ${l.lote}. Sai da lista até amanhã.`, 'ok', 5000);
    intelCalcular(); renderHoje(); intelContador();
  } catch (e) {
    erro(/recontagens/.test(e?.message || '') ? 'A tabela recontagens não existe — rode o migracao-validacao-auto.sql' : 'Não consegui pedir a recontagem', e);
  }
}

function intelTransferencia(a) {
  const l = a.l;
  if (!l) return;
  irPara('transferencias');
  $('t-codigo').value  = normalizarCodigo(l.cod);
  $('t-produto').value = l.produto || '';
  $('t-lote').value    = l.lote || '';
  $('t-qtd').value     = Math.round(Math.min(l.mapa, l.sistema || l.mapa) * 1000) / 1000;
  $('t-origem').value  = l.armsSis[0] || '';
  $('t-destino').value = l.armsMapa[0] || '';
  if (typeof buscarProdutoTf === 'function') buscarProdutoTf();
  toast('Confira origem e destino antes de criar a transferência.', 'warn', 5000);
}

async function intelRecusar(id) {
  const a = intelAchado(id);
  if (!a) return;
  if (!(await intelRegistrar(a, 'recusou'))) return;
  _intel.dec.push({ chave:a.id, tipo:a.tipo, decisao:'recusou', quando:new Date().toISOString() });
  intelIndexar();
  toast('Anotado: não sugiro mais isso enquanto os números forem os mesmos.', 'ok', 4000);
  if ($('page-hoje')?.classList.contains('active')) { intelCalcular(); renderHoje(); intelContador(); }
  else { renderSaldo?.(); renderSaldoErp?.(); }
}
async function intelAdiar(id) {
  const a = intelAchado(id);
  if (!a) return;
  const ate = new Date(iMaisUmDiaUtil(Date.now())).toISOString();
  if (!(await intelRegistrar(a, 'adiou', {}, ate))) return;
  _intel.dec.push({ chave:a.id, tipo:a.tipo, decisao:'adiou', ate, quando:new Date().toISOString() });
  intelIndexar();
  intelCalcular(); renderHoje(); intelContador();
  toast('Volta amanhã (próximo dia útil).', 'ok', 3000);
}

async function intelDesfazer(decId) {
  const d = (_intel.dec || []).find(x => x.id === decId);
  const ms = d?.detalhes?.mudancas || [];
  if (!ms.length) return;
  if (!confirm(`Desfazer "${d.detalhes.acao || d.tipo}" em ${ms.length} item(ns) (${ms.map(m => m.pos).join(', ')})?`)) return;
  try {
    for (const m of ms) {
      await atualizarResiliente(m.tab, { ...m.antes, updated_at:new Date().toISOString() }, q => q.eq('id', m.id));
      await registrarAlteracao({ acao:'ajustou', posicao:m.pos, codigo:d.detalhes.codigo, lote:d.detalhes.lote, armazem:d.detalhes.armazem,
        tabela_ref:m.tab, ref_id:m.id, obs:`desfeito: ${d.detalhes.acao || d.tipo} (Hoje)` });
    }
    await sb.from('inteligencia_decisao').insert({ quem:QUEM || null, chave:d.chave, tipo:d.tipo, decisao:'desfez', detalhes:{ ...d.detalhes, desfez:d.id } });
    toast('Desfeito.', 'ok', 3500);
  } catch (e) { erro('Não consegui desfazer tudo', e); }
  await intelDepois();
}

/* ═══════════ TELA HOJE ═══════════ */
async function carregarHoje(forcar = false) {
  const corpo = $('hj-corpo');
  if (corpo && !_intel.achados.length) corpo.innerHTML = '<div class="skeleton">olhando o saldo, o mapa e o que mudou…</div>';
  try {
    await Promise.all([carregarSaldoErp(forcar), intelCarregarDados(forcar)]);
    intelCalcular();
    renderHoje();
    intelContador();
  } catch (e) {
    if (corpo) corpo.innerHTML = `<div class="empty"><div class="empty-tit">Não foi possível carregar</div><div class="empty-sub">${esc(e.message)}</div></div>`;
  }
}

function intelContador() {
  const n = _intel.achados.filter(a => !a.oculto && a.grupo === 'arrumar').length;
  const el = $('nc-hoje');
  if (el) { el.textContent = n > 99 ? '99+' : n; el.hidden = !n; }
}

function hjCard(a) {
  const t = INTEL_TIPOS[a.tipo] || { rot:a.tipo, cor:'mute' };
  const l = a.l;
  const id = intelAttr(a.id);
  const cab = l ? `<div class="hj-prod">${esc(l.produto || '')}<span class="mono"> · ${esc(l.cod)} · lote ${esc(l.lote || '—')} · ${esc([...new Set([...l.armsMapa, ...l.armsSis])].join(' / ') || '—')}</span></div>` : '';
  return `<article class="hj-card hj-${t.cor}">
    <div class="hj-top"><span class="tag ${INTEL_COR[t.cor] || 't-mute'}">${esc(t.rot)}</span>${a.grupo !== 'regras' ? intelConfHTML(a.conf) : ''}</div>
    <h3 class="hj-tit">${a.titulo}</h3>
    ${cab}
    <p class="hj-txt">${a.txt}</p>
    ${a.pistas.length ? `<ul class="iv-pistas">${a.pistas.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
    <div class="iv-acoes">
      ${a.acoes.map((x, i) => `<button class="btn btn-sm${x.primaria ? ' btn-primary' : ''}" onclick="intelAcao('${id}', ${i})">${esc(x.rot)}</button>`).join('')}
      ${l ? `<button class="btn btn-sm btn-ghost" onclick="hjVerLinha('${intelAttr(l.lote || '')}')">Ver no Mapa × sistema</button>` : ''}
      <span class="hj-esp"></span>
      <button class="btn btn-sm btn-ghost" onclick="intelAdiar('${id}')" title="Some até o próximo dia útil">Adiar</button>
      <button class="btn btn-sm btn-ghost" onclick="intelRecusar('${id}')" title="Não é isso — não sugerir de novo enquanto os números forem os mesmos">Não é isso</button>
    </div>
  </article>`;
}
function hjVerLinha(lote) { irPara('saldo'); saVerNasDivergencias(lote); }

function hjFiltro(t) { _intel.filtro = _intel.filtro === t ? '' : t; renderHoje(); }

function renderHoje() {
  const corpo = $('hj-corpo');
  if (!corpo) return;
  const vis = _intel.achados.filter(a => !a.oculto);
  const g = { arrumar:[], aguardando:[], regras:[], semPista:[] };
  for (const a of vis) (g[a.grupo] || g.arrumar).push(a);

  // Cabeçalho: bom dia + de quando são os dados.
  const h = new Date().getHours();
  const ola = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = (USUARIO?.nome || QUEM || '').split(' ')[0];
  $('hj-ola').textContent = `${ola}${nome ? ', ' + nome : ''}.`;
  const f = _sa?.foto;
  $('hj-sub').innerHTML = (f ? `Saldo do ERP de <b>${esc(fmtTS(f.ate))}</b> (${esc(haQuanto(iTs(f.ate)))}). ` : '') +
    (g.arrumar.length ? `<b>${num(g.arrumar.length)}</b> coisa(s) para arrumar, da mais importante para a menos.` : 'Nada para arrumar agora.');

  const avisos = [];
  if (_intel.erroMov) avisos.push('O sistema ainda não grava o que muda no ERP a cada envio — rode o <code>sql/migracao-inteligencia.sql</code> no Supabase. Sem ele, as causas "saiu e não foi baixado" e "entrou e não foi mapeado" não aparecem.');
  else if (!(_intel.mov || []).length) avisos.push('O "filme" do ERP começa a partir do próximo envio do robô. Até lá, as causas de entrada e saída ainda não aparecem.');
  if (_intel.erroDec) avisos.push('As decisões (recusar, adiar, desfazer) não estão sendo guardadas — rode o <code>sql/migracao-inteligencia.sql</code>.');

  // Filtro por tipo (só dos que estão para arrumar).
  const cont = {};
  for (const a of g.arrumar) cont[a.tipo] = (cont[a.tipo] || 0) + 1;
  const tipos = Object.keys(cont).sort((a, b) => cont[b] - cont[a]);
  if (_intel.filtro && !cont[_intel.filtro]) _intel.filtro = '';
  const arr = _intel.filtro ? g.arrumar.filter(a => a.tipo === _intel.filtro) : g.arrumar;
  const p = fatiar('hoje', arr, _intel.filtro + '|' + arr.length);

  // Feito hoje + quem mapeou (aprendizado).
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const desfeitas = new Set((_intel.dec || []).filter(d => d.decisao === 'desfez').map(d => d.detalhes?.desfez));
  const feitos = (_intel.dec || []).filter(d => d.decisao === 'aplicou' && iTs(d.quando) >= hoje.getTime()).reverse();
  const porQuem = {};
  const desde90 = Date.now() - 90 * 864e5;
  for (const d of _intel.dec || []) {
    if (d.decisao !== 'aplicou' || iTs(d.quando) < desde90 || desfeitas.has(d.id)) continue;
    for (const q of d.detalhes?.quemMapeou || []) {
      const x = porQuem[q] ||= { n:0, tipos:{} };
      x.n++; x.tipos[d.tipo] = (x.tipos[d.tipo] || 0) + 1;
    }
  }
  const quem = Object.entries(porQuem).sort((a, b) => b[1].n - a[1].n);

  corpo.innerHTML = `
    ${avisos.map(t => `<div class="aviso a-info"><span class="aviso-ico">◔</span><div>${t}</div></div>`).join('')}
    <div class="hj-resumo">
      <button class="hj-n${!_intel.filtro ? ' on' : ''}" onclick="hjFiltro('')"><b>${num(g.arrumar.length)}</b><span>para arrumar</span></button>
      <a class="hj-n" href="#hj-aguardando"><b>${num(g.aguardando.length)}</b><span>aguardando o ERP ou o mapa</span></a>
      <a class="hj-n" href="#hj-regras"><b>${num(g.regras.length)}</b><span>regras do armazém</span></a>
      <a class="hj-n" href="#hj-feito"><b>${num(feitos.length)}</b><span>resolvido(s) hoje</span></a>
    </div>
    ${tipos.length > 1 ? `<div class="hj-tipos">${tipos.map(t => `<button class="sa-rap${_intel.filtro === t ? ' on' : ''}" onclick="hjFiltro('${t}')">${esc(INTEL_TIPOS[t]?.rot || t)} <b>${cont[t]}</b></button>`).join('')}</div>` : ''}

    <section class="hj-sec">
      <h2>Para arrumar</h2>
      <div class="hj-lista">${p.itens.map(hjCard).join('') || '<div class="empty"><div class="empty-ico">✓</div><div class="empty-tit">Tudo em ordem</div><div class="empty-sub">Nenhuma divergência com causa para corrigir agora.</div></div>'}</div>
      ${barraPag('hoje', p, 'item(ns)')}
    </section>

    <section class="hj-sec" id="hj-aguardando">
      <h2>Aguardando <small>dentro de 1 dia útil — ainda não é erro</small></h2>
      <div class="hj-lista">${g.aguardando.map(hjCard).join('') || '<div class="hj-vazio">Nada esperando.</div>'}</div>
    </section>

    <section class="hj-sec" id="hj-regras">
      <h2>Regras do armazém</h2>
      <div class="hj-lista">${g.regras.map(hjCard).join('') || '<div class="hj-vazio">Nenhuma regra furada.</div>'}</div>
    </section>

    ${g.semPista.length ? `<section class="hj-sec">
      <details><summary><h2>Falta mapear, sem pista <small>${num(g.semPista.length)} lote(s)</small></h2></summary>
        <p class="hj-txt">Saldo do ERP sem vaga no mapa e sem movimento recente que explique — normal enquanto o pavilhão está sendo mapeado.
          <button class="btn btn-sm btn-ghost" onclick="irPara('saldo');saAba('planilha');saRapido('faltam')">Ver na planilha</button></p>
      </details></section>` : ''}

    <section class="hj-sec" id="hj-feito">
      <h2>Resolvido hoje</h2>
      ${feitos.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Hora</th><th>Quem</th><th>O quê</th><th>Lote</th><th></th></tr></thead><tbody>
        ${feitos.map(d => `<tr><td class="mono">${esc(fmtTS(d.quando).split(' ').pop() || '')}</td><td>${esc(d.quem || '—')}</td>
          <td>${esc(d.detalhes?.acao || INTEL_TIPOS[d.tipo]?.rot || d.tipo)}<div class="sub">${esc(d.detalhes?.titulo || '')}</div></td>
          <td class="mono">${esc(d.detalhes?.lote || '—')}</td>
          <td>${desfeitas.has(d.id) ? '<span class="tag t-mute">desfeito</span>' : d.detalhes?.mudancas?.length ? `<button class="btn btn-sm btn-ghost" onclick="intelDesfazer(${d.id})">Desfazer</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="hj-vazio">Nada ainda hoje.</div>'}
    </section>

    ${quem.length ? `<section class="hj-sec">
      <h2>Correções por quem mapeou <small>últimos 90 dias — para treinar, não para punir</small></h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quem</th><th class="num">Correções</th><th>Mais comum</th></tr></thead><tbody>
        ${quem.map(([q, x]) => { const top = Object.entries(x.tipos).sort((a, b) => b[1] - a[1])[0];
          return `<tr><td>${esc(q)}</td><td class="num">${num(x.n)}</td><td>${esc(INTEL_TIPOS[top[0]]?.rot || top[0])} (${top[1]})</td></tr>`; }).join('')}
      </tbody></table></div>
    </section>` : ''}`;
}

/* Contador do menu sem precisar abrir a tela: carrega em segundo plano
   depois que o painel abre. */
function intelIniciarSegundoPlano() {
  setTimeout(() => {
    if ($('page-hoje')?.classList.contains('active')) return;
    Promise.all([carregarSaldoErp(false), intelCarregarDados(false)]).then(() => { intelCalcular(); intelContador(); }).catch(() => {});
  }, 2500);
}
