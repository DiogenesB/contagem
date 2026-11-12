-- ═══════════════════════════════════════════════════════════════
-- SALDO DO ERP AUTOMÁTICO → Saldo mapeado
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
--
-- O robô (robo/atualizar-saldo.ps1) atualiza a planilha do ERP e
-- manda as linhas cruas para a função importar_estoque_ref. A função
-- faz o mesmo que o botão "Geral — todos os armazéns" da aba Saldo
-- mapeado: apaga a foto das filiais que vieram e grava a nova, tudo
-- numa transação só (se der erro no meio, a foto antiga fica).
--
-- Não mexe em saldo_sistema: o saldo que abre o ciclo de contagem
-- continua sendo importado à mão, na Validação.
-- ═══════════════════════════════════════════════════════════════

-- Colunas que a tela usa (já existem se a migração anterior rodou).
alter table estoque_ref add column if not exists tipo          text;
alter table estoque_ref add column if not exists empenho       numeric;
alter table estoque_ref add column if not exists importado_por text;
alter table estoque_ref add column if not exists importado_em  timestamptz default now();
-- Fabricação e validade do lote (a identificação do palete usa).
alter table estoque_ref add column if not exists dt_fabricacao date;
alter table estoque_ref add column if not exists dt_validade   date;
-- Paletes e caixas da planilha SB8_SALDOS_LOTES (tela Saldo do painel).
alter table estoque_ref add column if not exists paletes       numeric;
alter table estoque_ref add column if not exists caixas        numeric;

-- Registro de cada envio: quando, quantas linhas, se deu certo.
create table if not exists estoque_ref_sync (
  id       bigint generated always as identity primary key,
  quando   timestamptz not null default now(),
  origem   text,
  linhas   int,
  filiais  text[]
);

-- Valor de célula como texto. O Excel manda código, lote e filial
-- como número quando a célula é numérica (12007000091 vira
-- 12007000091.0) — aqui ele volta a ser texto sem a casa decimal.
create or replace function _celula_txt(v jsonb)
returns text language sql immutable as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then ''
    when jsonb_typeof(v) = 'number' and (v::text)::numeric = trunc((v::text)::numeric)
      then trunc((v::text)::numeric)::bigint::text
    when jsonb_typeof(v) = 'number' then (v::text)::numeric::text
    else btrim(v #>> '{}')
  end
$$;

-- Data de célula: o Excel manda data como número de série (46012 =
-- 22/12/2025); a planilha editada à mão pode mandar "22/12/2025".
create or replace function _celula_data(v jsonb)
returns date language plpgsql immutable as $$
declare t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return date '1899-12-30' + floor((v::text)::numeric)::int; end if;
  t := btrim(v #>> '{}');
  if t = '' then return null; end if;
  if t ~ '^\d{1,2}/\d{1,2}/\d{4}$' then return to_date(t, 'DD/MM/YYYY'); end if;
  if t ~ '^\d{4}-\d{2}-\d{2}' then return left(t, 10)::date; end if;
  if t ~ '^\d+(\.\d+)?$' then return date '1899-12-30' + floor(t::numeric)::int; end if;
  return null;
exception when others then return null;
end $$;

-- Número de célula tolerante: fórmula com erro (#DIV/0!) ou texto
-- vira vazio em vez de derrubar o envio inteiro.
create or replace function _celula_num(v jsonb)
returns numeric language plpgsql immutable as $$
declare t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' then return (v::text)::numeric; end if;
  t := replace(btrim(v #>> '{}'), ' ', '');
  if t = '' then return null; end if;
  if t ~ '^-?[\d.]*,\d+$' then t := replace(replace(t, '.', ''), ',', '.'); end if;
  if t ~ '^-?\d+(\.\d+)?$' then return t::numeric; end if;
  return null;
exception when others then return null;
end $$;

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

  -- Geral: troca a foto inteira das filiais que vieram.
  if fils is null then
    delete from estoque_ref where true;
  else
    delete from estoque_ref where filial = any(fils);
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

-- Conferência depois do primeiro envio:
-- select * from estoque_ref_sync order by quando desc limit 10;
