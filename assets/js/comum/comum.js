/* ═══════════════════════════════════════════════════════════════
   SIMBIOSE · COMUM.JS
   Tudo que o painel, o app do operador e o mapa usam igual.
   Antes isto vivia copiado nos dois arquivos: 363 linhas gêmeas
   que precisavam ser editadas em dobro. Uma cópia só, agora.
   Carregue ANTES do script da página, com uma tag script
   apontando para ./comum.js
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════ CONEXÃO ═══════════ */
const SUPABASE_URL = 'https://yuaboypybjqxxgntfyrq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IbvCmbnbazxMGcQTF9-mRg_Tt2RkAng';

/* ═══════════ FILIAL ═══════════ */
/* ═══════════════════════════════════════════════════════════════
   FILIAL — resolvedor tolerante
   Idêntico ao do mobile. O banco tem 4 formatos convivendo:
   código do ERP ('010001'), nome longo, nome curto e null.
   ═══════════════════════════════════════════════════════════════ */
const FILIAIS = [
  { slug:'simbiose', nome:'Simbiose Cruz Alta', curto:'Simbiose', codigos:['010001'], termo:'SIMBIOSE' },
  { slug:'bioma',    nome:'Bioma Cruz Alta',    curto:'Bioma',    codigos:['020006'], termo:'BIOMA'    },
  { slug:'biagro',   nome:'Biagro Cruz Alta',   curto:'Biagro',   codigos:['090010'], termo:'BIAGRO'   },
];
function resolverFilial(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const v = String(valor).trim().toUpperCase();
  if (!v) return null;
  for (const f of FILIAIS) {
    if (f.codigos.includes(v)) return f;
    if (v.includes(f.termo))   return f;
  }
  return null;
}
function filialCurta(v) { const f = resolverFilial(v); return f ? f.curto : (v ? String(v).trim() : '—'); }

/* ═══════════════════════════════════════════════════════════════
   POSIÇÕES DRIVE-IN  (1.932 vagas — mesma geração do mobile)
   ═══════════════════════════════════════════════════════════════ */
function montarDI(de, ate, nAndares, nLugares) {
  const linhas = {};
  for (let l = de; l <= ate; l++) {
    const andares = {};
    for (let a = 1; a <= nAndares; a++) andares[a] = Array.from({ length:nLugares }, (_, i) => i + 1);
    linhas[String(l).padStart(2, '0')] = andares;
  }
  return linhas;
}
const MAPA_POSICOES = {
  bioma:    { A1: montarDI(1, 36, 3, 5), A2: montarDI(29, 36, 3, 4) },
  simbiose: { B1: montarDI(1, 36, 4, 5), B2: montarDI(1, 36, 4, 4) },
};
const TODAS_POSICOES = (() => {
  const out = [];
  for (const pav of Object.values(MAPA_POSICOES))
    for (const [di, linhas] of Object.entries(pav))
      for (const [ln, andares] of Object.entries(linhas))
        for (const [an, lugares] of Object.entries(andares))
          for (const lg of lugares) out.push(`${di}-${ln}-${an}-${lg}`);
  return out;
})();
const linhaDaPosicao = p => String(p || '').split('-').slice(0, 2).join('-');

/* ═══════════════════════════════════════════════════════════════
   CATÁLOGO DE PRODUTOS
   Fonte: planilha do ERP (B8_PRODUTO, B1_DESC, B1_UM, kg/l pl).
   Indexado por CÓDIGO, não por nome: 10 produtos compartilham o
   mesmo nome em códigos diferentes (versões Simbiose × Biagro),
   então nome como chave é ambíguo.
   Formato: 'codigo': [nome, unidade, maximo_por_palete, filial]
   maximo null = amostra ou sem limite definido.
   filial = de qual empresa é o código (simbiose | bioma | biagro),
   tirada do ERP (B8_FILIAL). O MESMO nome existe com códigos de
   filiais diferentes — TRICH PROTECTION 10 L é 01007000091 na
   Simbiose e 12007000091 na Bioma. Escolher o gêmeo errado faz o
   lote "sumir" no cruzamento com o sistema. null = código sem saldo
   na planilha usada para montar a lista; a filial vem do saldo.
   ═══════════════════════════════════════════════════════════════ */
const PRODUTOS = {
  '01001000005': ['BIO 12 - 12 L (12X1)', 'L', 528, null],
  '01001000007': ['BIO 12 - 10 L (2X5)', 'L', 640, null],
  '01001000009': ['BIO 15 + NI - 10 L (2X5)', 'L', 640, null],
  '01001000010': ['BIO ATIVO - 20 L (1X20)', 'L', 480, null],
  '01001000021': ['BIO APPLIC O - 10 L (2X5)', 'L', 640, 'bioma'],
  '01001000030': ['BIO APPLIC D - 12 L (12X1)', 'L', 528, 'bioma'],
  '01001000031': ['BIO APPLIC F - 12 L (12X1)', 'L', 528, null],
  '01001000032': ['BIO APPLIC O - 12 L (12X1)', 'L', 528, 'bioma'],
  '01002000032': ['BIOMA PHOS - 12 L (12X1)', 'L', 528, 'bioma'],
  '01002000033': ['BIOMA PHOS - 12 L (6X2)', 'L', 768, 'bioma'],
  '01002000034': ['BIOMA PHOS - 10 L (2X5)', 'L', 640, 'bioma'],
  '01002000052': ['BIOMA PHOS - 5 L (20X0.25)', 'L', 300, 'simbiose'],
  '01002000053': ['BIOMA PHOS - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01002000054': ['BIOMA PHOS - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01002000055': ['BIOMA PHOS - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01002000063': ['BIAGRO ENERGIA - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01002000069': ['BIOMA PHOS - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01002000089': ['SOLUBPHOS - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01002000090': ['SOLUBPHOS - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01002000094': ['SOLUBPHOS - 12 L (12X1) ARGENTINA', 'L', 528, null],
  '01002100023': ['AMOSTRA BIOMAPHOS', 'L', null, 'simbiose'],
  '01002100026': ['BIAGRO ENERGIA - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01002100027': ['AMOSTRA SOLUBPHOS', 'L', null, 'simbiose'],
  '01002100028': ['AMOSTRA OMSUGO P', 'L', null, 'simbiose'],
  '01002100029': ['SOLUBPHOS - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01002100035': ['OMSUGO ECO - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01002100075': ['SOLUBPHOS - 12 L (12X1) INGLES', 'L', 528, 'simbiose'],
  '01002100088': ['SOLUBPHOS - 2 L - DM', 'L', 768, 'simbiose'],
  '01002100093': ['BIOMA PHOS - 2 L - DM', 'L', 768, 'bioma'],
  '01002100130': ['BIOMA BRADY SOJA LIQUIDO - 200 DS (2X100) ECO PACK', 'DS', 16800, 'bioma'],
  '01002100131': ['BIOMA BRADY SOJA LIQUIDO - 160 DS (4X40) ECO PACK', 'DS', 13440, 'bioma'],
  '01002100133': ['BIOMA MAIS LIQUIDO - 80 DS (4X20) ECO PACK', 'DS', 6720, 'bioma'],
  '01002100135': ['BIOMA RHYZO FEIJAO LIQUIDO - 60 DS (4X15) ECO PACK', 'DS', 5040, 'bioma'],
  '01002100136': ['BIOMA RHYZO CAUPI LIQUIDO - 60 DS (4X15) ECO PACK', 'DS', null, 'bioma'],
  '01002100144': ['BIOMA MAIS LIQUIDO - 100 DS (2X50) ECO PACK', 'DS', 8400, 'bioma'],
  '01002100145': ['SOLUBPHOS - 12 L (6X2) ARGENTINA', 'L', 768, 'simbiose'],
  '01002100180': ['AMOSTRA BIOSTML 0060 - 0.5 L (1X0.5)', 'L', null, 'simbiose'],
  '01002100193': ['SOLUBPHOS - 1 L - DM', 'L', 528, 'simbiose'],
  '01002100202': ['BIOMA PHOS - 1 L - DM', 'L', 528, 'bioma'],
  '01002100230': ['BIOMA MAIS ENERGY LIQUIDO - 100 DS (2X50)', 'DS', 8400, 'bioma'],
  '01002100233': ['BIOMA HYDRATUS - 12 L (6X2)', 'L', 768, null],
  '01002100263': ['SOLUBPHOS - 5 L - DM', 'L', null, 'simbiose'],
  '01002100281': ['AMOSTRA COGNY-008-MESP-0226-S - 2L', 'L', null, 'simbiose'],
  '01002100282': ['AMOSTRA COGNY-008-MESP-0226-S - 0,250 L', 'L', null, 'simbiose'],
  '01002100311': ['AMOSTRA OMSUGO P - 250 ML', 'L', null, 'simbiose'],
  '01002100314': ['SOLUBPHOS - 12 L (12X1) - FOLCOL - BOLIVIA', 'L', null, 'simbiose'],
  '01002100315': ['BIOMA HYDRATUS - 12 L (6X2) - FOLCOL - BOLIVIA', 'L', null, 'simbiose'],
  '01002100321': ['SOLUBPHOS - 12 L (12X1) - ADILSON - BOLIVIA', 'L', null, 'simbiose'],
  '01002100322': ['BIOMA HYDRATUS - 12 L (6X2) - ADILSON - BOLIVIA', 'L', null, 'simbiose'],
  '01002100324': ['COGNY-015-MESP-26-S 2L', 'L', null, 'simbiose'],
  '01002100325': ['COGNY-015-MESP-26-S 250 ML', 'L', null, 'simbiose'],
  '01003000010': ['LAPHY PROTECTION - 6 KG (6X1)', 'KG', 456, 'simbiose'],
  '01003100006': ['LOOPER PROTECTION - 6 KG (6X1)', 'KG', 456, 'simbiose'],
  '01003100007': ['VECTOR PROTECTION - 10 L (2X5)', 'L', 640, 'bioma'],
  '01003100011': ['VECTOR PROTECTION - 12 L (6X2)', 'L', 768, 'bioma'],
  '01003100051': ['BIOMA BRADY SOJA TURFOSO - 250 DS (5X50)', 'DS', 21000, 'bioma'],
  '01004000010': ['BIOMA FIX SUPER - 6 L (6X1)', 'L', 360, 'bioma'],
  '01005000001': ['AEDESCONTROL - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01005000002': ['AEDESCONTROL - 10 L', 'L', 750, 'simbiose'],
  '01005000004': ['AEDESCONTROL - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01006000001': ['INLAYON - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01006000006': ['NEMACONTROL SUPER - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01006000009': ['NEMACONTROL SUPER - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01006000010': ['AMOSTRA NEMACONTROL SUPER', 'L', null, 'simbiose'],
  '01006000015': ['NEMA PROTECTION - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01006100002': ['BIAGRO RAIZ - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01006100003': ['BIAGRO RAIZ - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01006100018': ['NEMA PROTECTION - 1 L - DM', 'L', 528, 'bioma'],
  '01006100020': ['NEMACONTROL SUPER - 6 L (6X1)', 'L', 528, 'simbiose'],
  '01006100022': ['NEMACONTROL SUPER - 1 L - DM', 'L', 528, 'simbiose'],
  '01006100023': ['NEMACONTROL SUPER - 2 L - DM', 'L', null, 'simbiose'],
  '01006100031': ['AMOSTRA PCA4', 'L', null, 'simbiose'],
  '01007000002': ['FX PROTECTION - 10 L (1X10)', 'L', 750, 'bioma'],
  '01007000004': ['BIAGRO PROTECAO - 12 L (6X2)', 'L', 768, null],
  '01007000008': ['STIMUCONTROL - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01007000014': ['AMOSTRA GREENCONTROL', 'KG', null, 'simbiose'],
  '01007000017': ['BIAGRO SOLO - 12 L (6X2)', 'L', 768, null],
  '01007000018': ['BIAGRO SOLO - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01007000019': ['FX PROTECTION - 12 L (12X1)', 'L', 528, null],
  '01007000021': ['FX PROTECTION - 10 L (2X5)', 'L', 640, null],
  '01007000022': ['GREENCONTROL - 6 KG (6X1)', 'KG', 456, null],
  '01007000023': ['STIMUCONTROL - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01007000024': ['STIMUCONTROL - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01007000027': ['STIMUCONTROL EVOLUTION - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01007000028': ['STIMUCONTROL EVOLUTION - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01007000083': ['STIMUCONTROL - 12 L (6X2) PARAGUAY', 'L', 768, null],
  '01007000091': ['TRICH PROTECTION - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01007000099': ['STIMUCONTROL - 10 L (2X5) PARAGUAY', 'L', 640, 'simbiose'],
  '01007100001': ['FX PROTECTION - 12 L (6X2)', 'L', 768, 'bioma'],
  '01007100002': ['BIAGRO PROTECAO - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01007100007': ['FRONTIERCONTROL - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01007100008': ['FRONTIERCONTROL - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01007100012': ['FRONTIERCONTROL - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01007100020': ['STIMUCONTROL - 2 L', 'L', 768, null],
  '01007100023': ['FRONTIERCONTROL - 2 L - DM', 'L', 768, 'simbiose'],
  '01007100024': ['STIMUCONTROL - 5 L - DM', 'L', null, 'simbiose'],
  '01007100029': ['FX PROTECTION - 2 L - DM', 'L', 768, 'bioma'],
  '01007100033': ['FRONTIERCONTROL - 5 L - DM', 'L', null, 'simbiose'],
  '01007100039': ['ESPORO DE TRICHODERMA HARZIANUM CCT2160', 'KG', 750, 'simbiose'],
  '01007100050': ['FRONTIERCONTROL - 1 L - DM', 'L', 528, 'simbiose'],
  '01007100051': ['STIMUCONTROL - 1 L - DM', 'L', 528, 'simbiose'],
  '01007100053': ['TRICH PROTECTION - 5 L - DM', 'L', null, 'bioma'],
  '01007100054': ['TRICH PROTECTION - 1 L - DM', 'L', 528, 'bioma'],
  '01007100055': ['FX PROTECTION - 1 L - DM', 'L', 528, 'bioma'],
  '01007100058': ['EFICAZCONTROL - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01007100061': ['ARTEFATO - 10 L (2X5)', 'L', null, 'simbiose'],
  '01007100063': ['EFICAZCONTROL - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01007100064': ['FRONTIERCONTROL - 10 L (2X5) - PARAGUAY', 'L', 640, null],
  '01007100065': ['EFICAZCONTROL - 2 L - DM', 'L', null, 'simbiose'],
  '01007100066': ['STIMUCONTROL - 2 L - DM', 'L', 768, 'simbiose'],
  '01007100067': ['EFICAZCONTROL - 1 L - DM', 'L', null, 'simbiose'],
  '01007100069': ['STIMUCONTROL EVOLUTION - 2 L - DM', 'L', null, 'simbiose'],
  '01007100071': ['AMOSTRA EFICAZCONTROL', 'L', null, null],
  '01007100072': ['ESPORO BEAUVERIA BASSIANA CBMAI 2359', 'KG', 375, 'simbiose'],
  '01007100083': ['STIMUCONTROL 12 L (12X1) - FOLCOL - BOLIVIA', 'L', null, 'simbiose'],
  '01007100084': ['STIMUCONTROL 12 L (12X1) - ADILSON - BOLIVIA', 'L', null, 'simbiose'],
  '01009000026': ['STIMU SPRAY O - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01009000027': ['STIMU SPRAY D - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01009000031': ['STIMU SPRAY D - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01009000032': ['STIMU SPRAY D - 10 L (1X10)', 'L', 750, 'simbiose'],
  '01009000034': ['STIMU SPRAY F - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01009000035': ['STIMU SPRAY O - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01009000036': ['STIMU SPRAY O - 10 L (1X10)', 'L', 750, 'simbiose'],
  '01009000038': ['STIMU SPRAY F - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01012000040': ['BIAGRO CRISTALLES - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01012000041': ['BIAGRO CRISTALLES - 10 L (1X10)', 'L', 750, 'simbiose'],
  '01012000042': ['BIAGRO CRISTALLES - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01012000043': ['BTCONTROL - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01012000044': ['BTCONTROL - 10 L (1X10)', 'L', 750, 'simbiose'],
  '01012000047': ['BTCONTROL - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01012000051': ['AMOSTRA VIRCONTROL S.F', 'KG', 456, 'simbiose'],
  '01012000061': ['FLYCONTROL - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01012000062': ['FLYCONTROL - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01012000063': ['FLYCONTROL - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01012000074': ['METHACONTROL EVOLUTION - 10 L (2X5)', 'L', 640, 'simbiose'],
  '01012000077': ['VIRCONTROL C.I - 6 KG (6X1)', 'KG', 456, 'simbiose'],
  '01012000078': ['VIRCONTROL S.F - 6 KG (12X0.5)', 'KG', 456, 'simbiose'],
  '01012000079': ['VIRCONTROL S.F - 6 KG (6X1)', 'KG', 456, 'simbiose'],
  '01012000089': ['VIRCONTROL H.A - 6 KG (6X1)', 'KG', 456, 'simbiose'],
  '01012000112': ['FLYCONTROL 12 L - (6X2) PARAGUAY', 'L', 768, null],
  '01012000116': ['AMOSTRA FLYCONTROL', 'L', null, null],
  '01012000127': ['VIRCONTROL SF - 1 KG - DM', 'KG', 456, 'simbiose'],
  '01012000141': ['METHACONTROL EVOLUTION - 5 L - DM', 'L', 640, null],
  '01012000147': ['FLYCONTROL - 5 L - DM', 'L', 640, null],
  '01012000148': ['FLYCONTROL - 2 L - DM', 'L', 768, 'simbiose'],
  '01012000164': ['BIOISA - 5 KG (1X5)', 'KG', 375, null],
  '01012000165': ['BTCONTROL - 5 L (1X5)', 'L', 720, 'simbiose'],
  '01012000166': ['VECTOR PROTECTION - 12 L (12X1)', 'L', 528, 'bioma'],
  '01012000182': ['FLYCONTROL - 1 L - DM', 'L', 528, 'simbiose'],
  '01012000183': ['BT PROTECTION - 5 L - DM', 'L', 640, null],
  '01012000188': ['AMOSTRA ESPORO TRICHODERMA – EX', 'KG', null, 'simbiose'],
  '01012000189': ['AMOSTRA SOLUBPHOS WP - ARGENTINA', 'KG', null, 'simbiose'],
  '01012000190': ['AMOSTRA SOLUBPHOS WP - EX', 'L', null, 'simbiose'],
  '01014000001': ['FACIENS PROTECTION - 10 L (1X10)', 'L', 750, null],
  '01014000002': ['NEMACONTROL - 12 L (12X1)', 'L', 528, 'simbiose'],
  '01014000003': ['NEMACONTROL - 12 L (6X2)', 'L', 768, 'simbiose'],
  '01014000029': ['TRANS F CONTROL - 10 L (2X5) PARAGUAY', 'L', 640, 'simbiose'],
  '01014000031': ['NEMACONTROL - 12 L (6X2) PARAGUAY', 'L', 768, null],
  '01014000037': ['NEMACONTROL - 2 L - DM', 'L', 768, 'simbiose'],
  '01014000042': ['NEMACONTROL - 1 L - DM', 'L', 528, 'simbiose'],
  '01014000044': ['AMOSTRA FACIENS PROTECTION', 'L', null, 'simbiose'],
  '01019000001': ['AMOSTRA SOLUBPHOS WP - EX', 'L', null, 'simbiose'],
  '01019000005': ['AMOSTRA OMSUGO P WP - ARGENTINA', 'L', null, 'simbiose'],
  '12001000002': ['STIMU LEG 12 - 12 L (12X1)', 'L', 528, 'simbiose'],
  '12001000003': ['STIMU LEG 15 + NI - 10 L (2X5)', 'L', 640, null],
  '12001000004': ['STIMU LEG 10 - 10 L (2X5)', 'L', 640, null],
  '12001000005': ['STIMU LEG 12 - 10 L (2X5)', 'L', 640, 'simbiose'],
  '12002000006': ['SIMBIOSENOD SOJA LIQUIDO - 200 DS (2X100)', 'DS', 16800, null],
  '12002000198': ['SIMBIOSENOD SOJA LIQUIDO - 160 DS (4X40) ULTRA CASE', 'DS', 13440, 'simbiose'],
  '12002000199': ['SIMBIOSE MAIZ LIQUIDO - 100 DS (2X50) ULTRA CASE', 'DS', 8400, 'simbiose'],
  '12002000200': ['SIMBIOSENOD ULTRA TSI - 80 DS (2X40) ULTRA CASE', 'DS', 6720, 'simbiose'],
  '12002000201': ['SIMBIOSENOD SOJA LIQUIDO - 200 DS (2X100) ULTRA CASE', 'DS', 16800, 'simbiose'],
  '12002000202': ['SIMBIOSE MAIZ LIQUIDO - 80 DS (4X20) ULTRA CASE', 'DS', 6720, 'simbiose'],
  '12002000205': ['SIMBIOSENOD FEIJAO LIQUIDO - 60 DS (4X15) ULTRA CASE', 'DS', 4620, 'simbiose'],
  '12002000259': ['BIOMA HYDRATUS - 10 L (2X5)', 'L', 640, 'bioma'],
  '12002000260': ['BIOMA HYDRATUS - 12 L (6X2)', 'L', 768, 'bioma'],
  '12002000280': ['BIOMA HYDRATUS - 2 L - DM', 'L', 768, 'bioma'],
  '12002000305': ['COGNY-018-FH0826-O (MIX)', 'L', null, 'simbiose'],
  '12002000306': ['COGNY-017-FH-826-O (ALA)', 'L', null, 'simbiose'],
  '12002000307': ['AMOSTRA COGNY-013-FN-0926-B', 'L', null, 'simbiose'],
  '12002000308': ['AMOSTRA COGNY-012-FF-0926-B 1 L', 'L', null, 'simbiose'],
  '12003000029': ['BT PROTECTION - 10 L (1X10)', 'L', 750, 'bioma'],
  '12003000031': ['LAPHY PROTECTION - 6 KG (6X1)', 'KG', 456, 'bioma'],
  '12003000033': ['BT PROTECTION - 10 L (2X5)', 'L', 640, 'bioma'],
  '12003000036': ['LOOPER PROTECTION - 6 KG (6X1)', 'KG', 456, 'bioma'],
  '12003000043': ['VECTOR PROTECTION - 2 L - DM', 'L', null, 'bioma'],
  '12003000045': ['LAPHY PROTECTION - 1 KG - DM', 'KG', 456, 'bioma'],
  '12004000017': ['BIO PRO - TSI - 6 L (6X1)', 'L', 384, 'simbiose'],
  '12004000018': ['SIMBIOSE PRO SUPER - 6 L (6X1)', 'L', 384, 'simbiose'],
  '12004000029': ['SIMBIOSE PRO SUPER - 1 L - DM', 'L', null, 'simbiose'],
  '12006000001': ['NEMA PROTECTION - 12 L (6X2)', 'L', 768, 'bioma'],
  '12006000017': ['NEMA PROTECTION - 12 L (12X1)', 'L', 528, 'bioma'],
  '12006000022': ['NEMA PROTECTION - 2 L - DM', 'L', null, 'bioma'],
  '12007000007': ['TRICH PROTECTION - 12 L (12X1)', 'L', 528, 'bioma'],
  '12007000091': ['TRICH PROTECTION - 10 L (2X5)', 'L', 640, 'bioma'],
  '12007000092': ['TRICH PROTECTION - 12 L (6X2)', 'L', 768, 'bioma'],
  '12007000114': ['TRICH PROTECTION - 2 L - DM', 'L', 768, 'bioma'],
  '12007000125': ['FX PROTECTION - 10 L (2X5)', 'L', 640, 'bioma'],
  '12007000126': ['FX PROTECTION - 12 L (12X1)', 'L', 528, 'bioma'],
  '12007000156': ['AMOSTRA PARA TESTE - COGNY-007-FF-0326-B', 'L', null, 'simbiose'],
  '12013000088': ['BIAGRO ENERGIA - 12 L (6X2)', 'L', 768, 'biagro'],
  '12014000002': ['METHACONTROL - 10 KG (2X5)', 'KG', 640, null],
  '12016000018': ['ISACONTROL - 10 L (2X5)', 'L', 640, null],
  '12016000030': ['PERC PROTECTION - 10 L (2X5)', 'L', 640, 'bioma'],
  '12019000010': ['SIMBIOSENOD SOJA TURFOSO - 250 DS (5X50)', 'DS', 21000, 'simbiose'],
};

/* Índice por nome, para quando só o nome estiver disponível
   (registros antigos, lançamentos digitados à mão). */
const PRODUTOS_POR_NOME = (() => {
  const idx = {};
  for (const [cod, [nome, um, lim]] of Object.entries(PRODUTOS)) {
    const k = String(nome).trim().toUpperCase();
    if (!(k in idx)) idx[k] = [cod, um, lim];
  }
  return idx;
})();

function produtoPorCodigo(codigo) {
  const c = String(codigo ?? '').trim();
  const p = PRODUTOS[c] || PRODUTOS[c.padStart(11, '0')];
  return p ? { codigo:c, nome:p[0], unidade:p[1], palete:p[2], filial:p[3] || null } : null;
}

/* ═══════════════════════════════════════════════════════════════
   FILIAL DO PRODUTO
   O código diz de qual empresa é o produto. Tudo que grava, busca
   ou cruza código usa estas funções — uma regra só nos quatro apps.
   ═══════════════════════════════════════════════════════════════ */
/* Entrada de FILIAIS (slug, nome, curto, códigos) do código, ou null. */
function filialDoProduto(codigo) {
  const p = produtoPorCodigo(normalizarCodigo(codigo));
  return p?.filial ? FILIAIS.find(f => f.slug === p.filial) || null : null;
}
/* Código da filial no ERP ('010001'), no formato que o saldo grava. */
const codigoFilialDoProduto = codigo => filialDoProduto(codigo)?.codigos[0] || null;

/* Registro sem filial (gravado antes, ou por tela que não mandava)
   herda a do código. Sem isso, ele some quando se filtra por filial. */
function comFilial(lista) {
  for (const r of lista || []) if (r && !r.filial && r.codigo) r.filial = codigoFilialDoProduto(r.codigo);
  return lista;
}

/* Os outros códigos com o MESMO nome (as versões de outra filial). */
function gemeosDoProduto(codigo) {
  const c = normalizarCodigo(codigo);
  const p = PRODUTOS[c];
  if (!p) return [];
  const nome = String(p[0]).trim().toUpperCase();
  return Object.keys(PRODUTOS).filter(k => k !== c && String(PRODUTOS[k][0]).trim().toUpperCase() === nome);
}
/* Só o nome repete entre filiais? Aí a filial precisa aparecer em
   destaque na busca, senão o conferente escolhe o primeiro da lista. */
const temGemeo = codigo => gemeosDoProduto(codigo).length > 0;

/* Selo "● Bioma" para qualquer lista. `slugOuCodigo` aceita o slug
   da filial, o código do ERP da filial ou o código do produto. */
function seloFilial(slugOuCodigo, { destaque = false } = {}) {
  const v = String(slugOuCodigo ?? '').trim();
  if (!v) return '';
  const f = FILIAIS.find(x => x.slug === v) || resolverFilial(v) || filialDoProduto(v);
  if (!f) return '';
  return `<span class="selo-fil sf-${f.slug}${destaque ? ' sf-destaque' : ''}" title="Código da ${f.nome}">${f.curto}</span>`;
}

/* Quais código+lote existem no sistema (saldo da contagem e planilha
   do Saldo mapeado). Só a existência — serve para achar o código da
   filial certa quando alguém escolhe o gêmeo. Guarda por 5 minutos. */
let _lotesSis = null, _lotesSisEm = 0;
async function lotesDoSistema() {
  if (_lotesSis && Date.now() - _lotesSisEm < 300000) return _lotesSis;
  const set = new Set();
  for (const t of ['saldo_sistema', 'estoque_ref']) {
    try {
      const d = await buscarTudo(() => sb.from(t).select('codigo, lote'));
      for (const r of d) if (r.codigo) set.add(`${chave(normalizarCodigo(r.codigo))}|${chave(r.lote)}`);
    } catch { /* tabela ausente: segue sem ela */ }
  }
  _lotesSis = set; _lotesSisEm = Date.now();
  return set;
}
/* Se o lote não existe com este código e existe com um gêmeo de outra
   filial, pergunta se troca. Devolve o código a usar (o mesmo, se não
   trocar ou não houver o que trocar). */
async function conferirCodigoDaFilial(codigo, lote) {
  const c = normalizarCodigo(codigo);
  if (!lote || !temGemeo(c)) return c;
  const set = await lotesDoSistema();
  if (!set.size || set.has(`${chave(c)}|${chave(lote)}`)) return c;
  const gem = gemeosDoProduto(c).find(g => set.has(`${chave(g)}|${chave(lote)}`));
  if (!gem) return c;
  const fa = filialDoProduto(c)?.curto || 'outra filial', fb = filialDoProduto(gem)?.curto || 'outra filial';
  return confirm(`O lote ${lote} não existe com o código ${c} (${fa}).\n` +
    `Ele existe no sistema com o código ${gem} (${fb}) — mesmo produto, outra filial.\n\n` +
    `OK = usar ${gem} (${fb})\nCancelar = manter ${c}`) ? gem : c;
}

/* Estilo do selo, injetado uma vez para os quatro apps herdarem sem
   cada um repetir o CSS. Cor só no ponto; o nome vai escrito. */
(function () {
  if (typeof document === 'undefined' || document.getElementById('css-selo-fil')) return;
  const st = document.createElement('style');
  st.id = 'css-selo-fil';
  st.textContent = `
    .selo-fil { display:inline-flex; align-items:center; gap:5px; vertical-align:middle;
      padding:0 7px 0 6px; border-radius:100px; line-height:18px; white-space:nowrap;
      font-family:var(--sans, system-ui, sans-serif); font-size:11px; font-weight:600;
      color:var(--text-2, var(--text2, var(--muted, currentColor)));
      background:rgba(127,127,127,.12); border:1px solid rgba(127,127,127,.28); }
    .selo-fil::before { content:''; width:7px; height:7px; border-radius:50%; background:var(--sf-cor); }
    .sf-simbiose { --sf-cor:#16A34A; }
    .sf-bioma    { --sf-cor:#0891B2; }
    .sf-biagro   { --sf-cor:#D97706; }
    .selo-fil.sf-destaque { color:var(--text, var(--ink, currentColor)); border-color:var(--sf-cor);
      background:color-mix(in srgb, var(--sf-cor) 14%, transparent); }`;
  (document.head || document.documentElement).appendChild(st);
})();


/* Unidade de medida vem do catálogo: L, KG ou DS conforme o
   produto. "un." genérico não diz nada para quem está no galpão. */
function unidadeDe(codigo, nome) {
  const p = produtoPorCodigo(codigo);
  if (p?.unidade) return p.unidade;
  const n = PRODUTOS_POR_NOME[String(nome ?? '').trim().toUpperCase()];
  return n ? n[1] : '';
}

/* "24 L" · "1.200 DS" · "56 KG" — cai para "un." só se o produto
   não estiver no catálogo. */
function qtdUn(qtd, codigo, nome) {
  const u = unidadeDe(codigo, nome);
  return `${num(qtd)} ${u || 'un.'}`;
}

function limitePalete(nomeOuCodigo, codigo) {
  const p = codigo ? produtoPorCodigo(codigo) : produtoPorCodigo(nomeOuCodigo);
  if (p) return p.palete;
  const n = PRODUTOS_POR_NOME[String(nomeOuCodigo ?? '').trim().toUpperCase()];
  return n ? n[2] : null;
}

/* ═══════════════════════════════════════════════════════════════
   MOTIVOS DE DIVERGÊNCIA
   `conta:false` = o produto existe, só não está no drive. Não é
   erro de estoque, então sai da acurácia.
   `conta:true`  = ninguém sabe onde está, ou sobrou sem origem.
   É erro de verdade e precisa aparecer no indicador.
   ═══════════════════════════════════════════════════════════════ */
const MOTIVOS = [
  { id:'envase',        texto:'Produto no envase',                  conta:false },
  { id:'qualidade',     texto:'Produto retido com a qualidade',     conta:false },
  { id:'transferencia', texto:'Em transferência entre armazéns',    conta:false },
  { id:'faturado',      texto:'Faturado, aguardando carregamento',  conta:false },
  { id:'erp',           texto:'Apontamento do ERP atrasado',        conta:false },
  { id:'nao_encontrado',texto:'Não encontrado no estoque',          conta:true  },
  { id:'sobra',         texto:'Sobra sem origem identificada',      conta:true  },
  { id:'erro_contagem', texto:'Erro de contagem',                   conta:true  },
  { id:'outro',         texto:'Outro (descrever abaixo)',           conta:true  },
];
const motivoPorId = id => MOTIVOS.find(m => m.id === id) || null;
const textoMotivo = id => motivoPorId(id)?.texto || (id || '—');

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

/* Chave de cruzamento — A MESMA do mobile. Divergir aqui gera órfão. */
const chave = v => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
const chaveLote = (cod, lote, arm) => `${chave(cod)}|${chave(lote)}|${chave(arm)}`;

/* ═══════════════════════════════════════════════════════════════
   ARMAZÉNS FÍSICOS (B8_LOCAL)
   Os que têm mercadoria de verdade no galpão. Qualquer outro código
   que aparecer num lançamento é erro de digitação — e um armazém
   digitado errado faz o mesmo lote virar duas divergências no
   Saldo mapeado (uma "sobra" num armazém, uma "falta" no outro).
   Vale para as duas filiais.
   ═══════════════════════════════════════════════════════════════ */
/* Lista do ERP (NNR). Quais ficam no drive-in e entram no mapa:
   ARM_MAPEADOS, em saldo-mapeado.js. 88 e D3 existem, mas não são mapeados. */
const ARMAZENS = {
  '96': 'TRIANGULAÇÃO',
  '42': 'PA ESTOQUE ABASTECIMENTO',
  '48': 'DESCARTE QUALIDADE',
  '49': 'PA AMOSTRAS',
  '85': 'DESMONTE',
  '88': 'CONTROLE DE AMOSTRAS - CQ',
  '91': 'REVALIDAÇÃO / RETRABALHO',
  '94': 'RETRABALHO / REVALIDAÇÃO',
  '98': 'QUARENTENA',
  'CE': 'CONTROLE DE ESTOQUE DE CLIENTES',
  'D2': 'FATURAMENTO',
  'D3': 'DIFERENÇA DE ESTOQUE',
  'D4': 'AVARIA',
  'D5': 'RISCO SHELF LIFE',
  'D6': 'BLOQUEADO CQ',
  'D7': 'VENCIDOS',
  'D8': 'FRACIONADO - DM',
};
/* "d 7" → "D7". Espaço e caixa não podem criar armazém novo. */
const normalizarArmazem = v => chave(v);
const armazemConhecido  = v => Object.prototype.hasOwnProperty.call(ARMAZENS, normalizarArmazem(v));
const nomeArmazem       = v => ARMAZENS[normalizarArmazem(v)] || '';

/* Confere o armazém antes de gravar. Desconhecido pede confirmação
   em vez de bloquear: se abrir um armazém novo no ERP, o galpão
   não para esperando atualizar o código. */
function confirmarArmazem(v) {
  const a = normalizarArmazem(v);
  if (!a || armazemConhecido(a)) return true;
  return confirm(`O armazém "${a}" não existe na lista.\n\n` +
    `Armazéns válidos: ${Object.keys(ARMAZENS).join(', ')}\n\n` +
    `Gravar assim mesmo?`);
}

const num = n => Number(n ?? 0).toLocaleString('pt-BR');
const num1 = n => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits:1, maximumFractionDigits:1 });

function fmtTS(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}
function fmtDia(ts) { return ts ? new Date(ts).toLocaleDateString('pt-BR') : '—'; }
function mesLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
}

function toast(msg, tipo = 'ok', dur = 3800) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${tipo} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur);
}
function erro(prefixo, e) { console.error(prefixo, e); toast(`${prefixo}: ${e?.message || e}`, 'err', 7000); }

function abrirModal(id)  { $(id).classList.add('open'); }
function fecharModal(id) { $(id).classList.remove('open'); }
function busy(b, s, on) { const x = $(b), y = $(s); if (x) x.disabled = on; if (y) y.style.display = on ? 'block' : 'none'; }

function vazio(tit, sub, cols) {
  return `<tr><td colspan="${cols}"><div class="empty"><div class="empty-ico">◻</div><div class="empty-tit">${esc(tit)}</div><div class="empty-sub">${sub || ''}</div></div></td></tr>`;
}
function carregando(cols) {
  return `<tr><td colspan="${cols}"><div class="skeleton">carregando…</div></td></tr>`;
}

/* ═══════════════════════════════════════════════════════════════
   NÚMERO E BUSCA
   ═══════════════════════════════════════════════════════════════ */
/* O app do operador chamava isto de fmtQtd. Mesmo formatador. */
const fmtQtd = num;

/* Código canônico do ERP: 11 dígitos com zero à esquerda.
   Use SEMPRE ao gravar, não só ao ler — é o que impede o
   problema de "01012000041" virar "1012000041" no banco. */
function normalizarCodigo(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return /^\d+$/.test(s) && s.length < 11 ? s.padStart(11, '0') : s.toUpperCase();
}

/* Campo de busca pré-calculado. Monte uma vez na carga em vez de
   concatenar os campos a cada tecla digitada. */
function chaveBusca(r) {
  return [r.codigo, r.produto_nome, r.produto, r.descricao, r.lote, r.armazem, r.posicao, r.usuario]
    .filter(Boolean).join(' ').toUpperCase();
}
/* A busca aceita vários termos separados por vírgula: digitar
   "A1-09, B1-01" procura os dois, não a frase inteira. Espaço
   dentro de um termo continua sendo parte dele ("BIO 12"). */
function termos(q) {
  return String(q || '').toUpperCase().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
}

function casa(r, q) {
  const ts = Array.isArray(q) ? q : termos(q);
  if (!ts.length) return true;
  const b = r._busca ?? (r._busca = chaveBusca(r));
  return ts.some(t => b.includes(t));
}

/* Cor estável a partir de um texto: o mesmo lote pinta sempre da
   mesma cor, em qualquer máquina, sem tabela para manter. */
function corDe(txt) {
  const s = String(txt || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} var(--sat, 62%) var(--lum, 52%))`;
}

function diasDesde(ts) {
  if (!ts) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 86400000));
}

/* ═══════════════════════════════════════════════════════════════
   REDE
   ═══════════════════════════════════════════════════════════════ */
/* Paginação: o PostgREST corta em 1.000 linhas sem avisar.
   Tudo que pode passar disso passa por aqui. */
async function buscarTudo(construir, tamanho = 1000) {
  const out = [];
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await construir().range(de, de + tamanho - 1);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < tamanho) break;
  }
  return out;
}

const _colunasIgnoradas = {};

async function inserirResiliente(tabela, linhas, opcoes = {}) {
  let payload = Array.isArray(linhas) ? linhas : [linhas];
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const q = sb.from(tabela).insert(payload);
    const { data, error } = opcoes.retornar ? await q.select() : await q;
    if (!error) return data;

    const m = String(error.message || '').match(/Could not find the '([^']+)' column/i);
    if (!m) throw error;

    const col = m[1];
    (_colunasIgnoradas[tabela] ||= new Set()).add(col);
    console.warn(`[${tabela}] coluna "${col}" não existe no banco — reenviando sem ela.`);
    payload = payload.map(r => { const { [col]:_, ...resto } = r; return resto; });
  }
  throw new Error(`Não consegui inserir em ${tabela} depois de remover as colunas ausentes.`);
}

/* UPDATE que tolera coluna inexistente, igual ao inserirResiliente.
   Serve para as colunas de auditoria: se você ainda não rodou a
   migração, o update passa sem elas em vez de estourar. */
async function atualizarResiliente(tabela, patch, aplicarFiltro) {
  let corpo = { ...patch };
  for (let i = 0; i < 8; i++) {
    const { error } = await aplicarFiltro(sb.from(tabela).update(corpo));
    if (!error) return true;
    const m = String(error.message || '').match(/Could not find the '([^']+)' column/i);
    if (!m || !(m[1] in corpo)) throw error;
    delete corpo[m[1]];
    if (!Object.keys(corpo).length) throw error;
  }
  throw new Error('não consegui gravar em ' + tabela);
}

/* ═══════════════════════════════════════════════════════════════
   TEMPO E TEMPORIZADORES
   ═══════════════════════════════════════════════════════════════ */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function haQuanto(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60)    return `há ${s}s`;
  if (s < 3600)  return `há ${Math.round(s / 60)}min`;
  if (s < 86400) return `há ${Math.round(s / 3600)}h`;
  return `há ${Math.round(s / 86400)}d`;
}

/* Cache simples por chave, com validade. Evita recarregar a aba
   inteira quando o usuário só foi ali e voltou. */
const _cache = {};
function cacheValido(chaveCache, segundos = 60) {
  const c = _cache[chaveCache];
  return !!c && (Date.now() - c.quando) < segundos * 1000;
}
function cacheGravar(chaveCache, valor) {
  _cache[chaveCache] = { quando:Date.now(), valor };
  return valor;
}
function cacheLer(chaveCache) { return _cache[chaveCache]?.valor; }
function cacheInvalidar(prefixo = '') {
  for (const k of Object.keys(_cache)) if (k.startsWith(prefixo)) delete _cache[k];
}

/* ═══════════════════════════════════════════════════════════════
   FÍSICO
   No pavilhão ninguém fica olhando para a tela. A vibração é o
   que confirma que o lançamento entrou.
   ═══════════════════════════════════════════════════════════════ */
function vibrar(tipo = 'ok') {
  if (!navigator.vibrate) return;
  try {
    navigator.vibrate(tipo === 'err' ? [70, 50, 70] : tipo === 'warn' ? [40, 40, 40] : 28);
  } catch (e) { /* iOS antigo */ }
}

/* ═══════════════════════════════════════════════════════════════
   TEMA — mesma chave nos três apps
   ═══════════════════════════════════════════════════════════════ */
function alternarTema() {
  const novo = document.documentElement.getAttribute('data-tema') === 'claro' ? 'escuro' : 'claro';
  document.documentElement.setAttribute('data-tema', novo);
  try { localStorage.setItem('tema', novo); } catch (e) { /* modo privado */ }
  return novo;
}

/* ═══════════════════════════════════════════════════════════════
   QUEM ESTÁ MEXENDO
   Não é autenticação — é só o nome, para que toda alteração tenha
   dono. Sem nome, o app entra em modo leitura: dá para olhar, não
   para mudar.
   ═══════════════════════════════════════════════════════════════ */
let QUEM = '';

function lerQuem() {
  try { QUEM = (localStorage.getItem('quem') || '').trim(); } catch (e) { QUEM = ''; }
  return QUEM;
}

function gravarQuem(nome) {
  QUEM = String(nome || '').trim().slice(0, 40);
  try { localStorage.setItem('quem', QUEM); } catch (e) { /* modo privado */ }
  return QUEM;
}

function iniciais(nome) {
  return String(nome || '?').trim().split(/\s+/).slice(0, 2)
    .map(p => p[0]).join('').toUpperCase() || '?';
}

/* ═══════════════════════════════════════════════════════════════
   HISTÓRICO DE ALTERAÇÕES
   Toda mudança de vaga vira uma linha na tabela `alteracoes`.
   Se a tabela ainda não existe (migração não rodada), gravar falha
   em silêncio e a leitura devolve vazio — o resto continua
   funcionando.
   ═══════════════════════════════════════════════════════════════ */
async function registrarAlteracao(reg) {
  try {
    const { error } = await sb.from('alteracoes').insert({
      quem:      QUEM || 'sem nome',
      acao:      reg.acao,
      posicao:   reg.posicao || null,
      codigo:    reg.codigo || null,
      produto_nome: reg.produto_nome || null,
      lote:      reg.lote || null,
      armazem:   reg.armazem || null,
      qtd_antes: reg.qtd_antes ?? null,
      qtd_depois: reg.qtd_depois ?? null,
      tabela_ref: reg.tabela_ref || null,
      ref_id:    reg.ref_id ? String(reg.ref_id) : null,
      obs:       reg.obs || null,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('alteração não registrada:', e.message);
    return false;   // sem trilha, mas a operação em si já aconteceu
  }
}

async function lerAlteracoes({ posicao = null, limite = 200 } = {}) {
  try {
    let q = sb.from('alteracoes')
      .select('id, quem, acao, posicao, codigo, produto_nome, lote, armazem, qtd_antes, qtd_depois, obs, created_at')
      .order('created_at', { ascending:false }).limit(limite);
    if (posicao) q = q.eq('posicao', posicao);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  } catch (e) {
    return null;   // null = não deu para ler (tabela ausente); [] = leu e não tem nada
  }
}

const ACOES = {
  liberou:  { rot:'Liberou a vaga',      cor:'neg'  },
  expediu:  { rot:'Expediu',             cor:'alt'  },
  ajustou:  { rot:'Ajustou a quantidade', cor:'warn' },
  ocupou:   { rot:'Ocupou a vaga',       cor:'pos'  },
  moveu:    { rot:'Moveu de vaga',       cor:'alt'  },
  validou:  { rot:'Validou',             cor:'pos'  },
  excluiu:  { rot:'Excluiu',             cor:'neg'  },
  limpou:   { rot:'Limpou a linha',      cor:'neg'  },
};
function rotuloAcao(a) { return ACOES[a]?.rot || a; }
function corAcao(a)    { return ACOES[a]?.cor || 'mute'; }

/* ═══════════════════════════════════════════════════════════════
   LIMPAR LINHA
   Esvazia todas as vagas de uma linha do drive-in de uma vez.
   Busca no banco o que está ativo na linha (não confia só no que
   a tela tem em memória — o painel esconde ocupação antiga que
   ficou por baixo de um lançamento pendente, e ela voltaria no
   próximo carregamento), pede confirmação com o resumo e desativa
   tudo. Cada palete retirado vira uma linha em `alteracoes`.
   ═══════════════════════════════════════════════════════════════ */
function posicoesDaLinha(pav, di, ln) {
  const andares = MAPA_POSICOES[pav]?.[di]?.[ln] || {};
  const out = [];
  for (const an of Object.keys(andares))
    for (const lg of andares[an]) out.push(`${di}-${ln}-${an}-${lg}`);
  return out;
}

let _limpandoLinha = false;

async function limparLinha(di, ln, pav, { extra = null, quem = '', aoTerminar = null } = {}) {
  if (_limpandoLinha) return;
  // O app do operador guarda o nome em OPERADOR, não em QUEM.
  if (!QUEM && quem) QUEM = String(quem).trim();
  const nomeLinha = `${di}-${ln}`;
  const posicoes = posicoesDaLinha(pav, di, ln);
  if (!posicoes.length) { toast(`Linha ${nomeLinha} não existe no mapa.`, 'err'); return; }

  _limpandoLinha = true;
  try {
    const campos = 'id, posicao, codigo, produto_nome, lote, armazem, quantidade';
    const [hist, pend] = await Promise.all([
      sb.from('historico').select(campos).eq('ocupacao_ativa', true).in('posicao', posicoes),
      sb.from('lancamentos').select(campos).eq('status', 'pendente').eq('ocupacao_ativa', true).in('posicao', posicoes),
    ]);
    if (hist.error) throw hist.error;
    if (pend.error) throw pend.error;

    const itens = [
      ...(hist.data || []).map(r => ({ ...r, _tab:'historico' })),
      ...(pend.data || []).map(r => ({ ...r, _tab:'lancamentos' })),
    ];
    if (!itens.length) {
      toast(`A linha ${nomeLinha} já está vazia.`, 'ok');
      if (aoTerminar) await aoTerminar();
      return;
    }

    const vagas = new Set(itens.map(r => r.posicao)).size;
    const total = itens.reduce((s, r) => s + (Number(r.quantidade) || 0), 0);
    const nPend = itens.filter(r => r._tab === 'lancamentos').length;
    const produtos = [...new Set(itens.map(r => r.produto_nome || r.codigo))];
    const resumoProd = produtos.slice(0, 4).join('\n  • ') + (produtos.length > 4 ? `\n  • … e mais ${produtos.length - 4}` : '');

    const ok = confirm(
      `Limpar a linha ${nomeLinha} inteira?\n\n` +
      `${itens.length} palete(s) em ${vagas} vaga(s) — ${num(total)} no total.\n` +
      (nPend ? `${nPend} deles ainda aguardando validação.\n` : '') +
      `\n  • ${resumoProd}\n\n` +
      `Todas as vagas da linha ficam livres.`);
    if (!ok) return;

    const agora = new Date().toISOString();
    const patch = { ocupacao_ativa:false, updated_at:agora, ...(extra || (QUEM ? { feito_por:QUEM } : {})) };
    for (const tab of ['historico', 'lancamentos']) {
      const ids = itens.filter(r => r._tab === tab).map(r => r.id);
      if (ids.length) await atualizarResiliente(tab, patch, q => q.in('id', ids));
    }

    // A trilha não segura a operação: se falhar, as vagas já estão livres.
    await Promise.all(itens.map(r => registrarAlteracao({
      acao:'limpou', posicao:r.posicao, codigo:r.codigo, produto_nome:r.produto_nome,
      lote:r.lote, armazem:r.armazem, qtd_antes:Number(r.quantidade) || 0, qtd_depois:0,
      tabela_ref:r._tab, ref_id:r.id, obs:`linha ${nomeLinha} limpa`,
    })));

    if (typeof cacheInvalidar === 'function') cacheInvalidar('mapa');
    toast(`Linha ${nomeLinha} limpa · ${vagas} vaga(s) liberada(s).`, 'ok', 4500);
    if (aoTerminar) await aoTerminar();
  } catch (e) {
    toast(`Não deu para limpar ${nomeLinha}: ${e?.message || e}`, 'err', 7000);
  } finally {
    _limpandoLinha = false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   SUGESTÃO DE PRODUTO
   Procura no catálogo por código ou por nome. Quem está no galpão
   raramente sabe o código de cabeça — sabe o nome. Digitar "bio 12"
   tem que trazer o produto tanto quanto digitar "0100100".
   ═══════════════════════════════════════════════════════════════ */
function buscarProdutos(termo, limite = 8) {
  const q = String(termo || '').trim().toUpperCase();
  if (q.length < 2) return [];

  const achados = [];
  for (const [cod, p] of Object.entries(PRODUTOS)) {
    const nome = String(p[0] || '');
    const nomeUp = nome.toUpperCase();
    let peso = -1;

    if (cod.startsWith(q))          peso = 0;   // código começando igual
    else if (nomeUp.startsWith(q))  peso = 1;   // nome começando igual
    else if (cod.includes(q))       peso = 2;
    else if (nomeUp.includes(q))    peso = 3;
    else {
      // Termo picado: "bio 12 l" acha "BIO 12 - 12 L (12X1)".
      const partes = q.split(/\s+/).filter(Boolean);
      if (partes.length > 1 && partes.every(x => nomeUp.includes(x))) peso = 4;
    }

    if (peso >= 0) achados.push({ peso, codigo:cod, nome, unidade:p[1], palete:p[2], filial:p[3] || null });
  }

  // Mesmo nome: ordena pela filial para os gêmeos ficarem lado a lado.
  achados.sort((a, b) => a.peso - b.peso || a.nome.localeCompare(b.nome, 'pt-BR') || String(a.filial).localeCompare(String(b.filial)));
  return achados.slice(0, limite);
}
