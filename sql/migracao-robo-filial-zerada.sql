-- ═══════════════════════════════════════════════════════════════
-- SALDO DO ERP: filial que zerou de vez não fica mais com linha velha
--
-- O robô troca a foto por filial. Em 25/11 a filial 090010 devolveu o
-- último lote que tinha (BIAGRO ENERGIA 12 L, lote 012-23/5004, 12 L no
-- armazém 91). A foto das 17h já não trouxe nenhuma linha dessa filial,
-- então a linha das 10h38 ficou no banco: o painel mostrava
-- "algum armazém é de 25/11/2026 10:38" e os 12 L contados duas vezes
-- (no 91 da 090010 e no 94 da 010001, para onde voltaram).
--
--   1. Apaga agora as linhas do robô mais velhas que a última foto dele.
--   2. A função de importação passa a apagar também tudo o que o mesmo
--      robô mandou antes, além das filiais que vieram.
--
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Limpa as sobras de agora ──
delete from estoque_ref e
where e.importado_por like 'robô%'
  and e.importado_em < (select max(x.importado_em) from estoque_ref x where x.importado_por = e.importado_por) - interval '10 minutes';

-- ── 2. A importação do robô, corrigida ──
create or replace function importar_estoque_ref(linhas jsonb, origem text default 'robô Excel')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n    int;
  fils text[];
begin
  if linhas is null or jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) = 0 then
    raise exception 'nenhuma linha recebida — a foto antiga foi mantida';
  end if;

  -- As mesmas regras da tela: código com 11 dígitos, armazém sem
  -- espaço e em maiúscula, lote em maiúscula, filial com 6 dígitos.
  create temp table _novo on commit drop as
  select
    case when _celula_txt(l->'B8_PRODUTO') ~ '^\d{1,10}$'
         then lpad(_celula_txt(l->'B8_PRODUTO'), 11, '0')
         else upper(_celula_txt(l->'B8_PRODUTO')) end                  as codigo,
    btrim(coalesce(l->>'B1_DESC', ''))                                 as descricao,
    upper(_celula_txt(l->'B8_LOTECTL'))                                 as lote,
    upper(regexp_replace(_celula_txt(l->'B8_LOCAL'), '\s+', '', 'g'))  as armazem,
    btrim(coalesce(l->>'B1_UM', ''))                                   as unidade,
    nullif(upper(btrim(coalesce(l->>'B1_TIPO', ''))), '')              as tipo,
    coalesce(_celula_num(l->'B8_SALDO'), 0)                             as saldo,
    _celula_num(l->'B8_EMPENHO')                                        as empenho,
    case when _celula_txt(l->'B8_FILIAL') ~ '^\d{1,5}$'
         then lpad(_celula_txt(l->'B8_FILIAL'), 6, '0')
         else _celula_txt(l->'B8_FILIAL') end                           as filial,
    _celula_data(l->'DT_FABRICACAO')                                    as dt_fabricacao,
    _celula_data(l->'DT_VALIDADE')                                      as dt_validade,
    _celula_num(l->'PALETES')                                           as paletes,
    _celula_num(l->'CXS')                                               as caixas
  from jsonb_array_elements(linhas) as l
  where _celula_txt(l->'B8_PRODUTO') <> '';

  select count(*) into n from _novo;
  if n = 0 then
    raise exception 'nenhuma linha com código — a foto antiga foi mantida';
  end if;

  select array_agg(distinct filial) filter (where filial <> '') into fils from _novo;

  -- Geral: troca a foto inteira das filiais que vieram — e também tudo o
  -- que ESTE robô mandou antes. Sem isso, a filial que zerou de vez (não
  -- veio nenhuma linha dela) ficava com a linha antiga para sempre.
  if fils is null then
    delete from estoque_ref where true;
  else
    delete from estoque_ref where filial = any(fils) or importado_por = origem;
  end if;

  insert into estoque_ref (codigo, descricao, lote, armazem, unidade, tipo, saldo, empenho, filial, dt_fabricacao, dt_validade, paletes, caixas, importado_por, importado_em)
  select codigo, descricao, lote, armazem, unidade, tipo, saldo, empenho, filial, dt_fabricacao, dt_validade, paletes, caixas, origem, now() from _novo;

  insert into estoque_ref_sync (origem, linhas, filiais) values (origem, n, fils);

  -- Histórico da tela Saldo (sql/migracao-saldo-historico.sql).
  -- Antes dessa migração a função não existe e o envio segue sem ele.
  if to_regprocedure('registrar_saldo_diario()') is not null then
    perform registrar_saldo_diario();
  end if;

  return jsonb_build_object('linhas', n, 'filiais', fils);
end;
$$;

-- Só a chave secreta (service_role) pode chamar. A chave pública que
-- está nas páginas não consegue apagar o saldo por aqui.
revoke execute on function importar_estoque_ref(jsonb, text) from public;
revoke execute on function importar_estoque_ref(jsonb, text) from anon, authenticated;
grant  execute on function importar_estoque_ref(jsonb, text) to service_role;

notify pgrst, 'reload schema';

-- Conferir: não pode sobrar linha do robô de hora diferente da última foto
-- select importado_por, importado_em, count(*) from estoque_ref group by 1, 2 order by 2 desc;
