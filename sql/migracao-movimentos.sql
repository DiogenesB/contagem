-- ═══════════════════════════════════════════════════════════════
-- MOVIMENTAÇÕES DO ERP (planilha Mov. Estoque · consulta MOVEST01)
--   erp_mov        cada movimento: entrada, saída (NF), entrada e saída
--                  interna (transferência entre armazéns, fracionamento,
--                  liberação de quarentena), com NF, pedido, cliente e TES
--   erp_mov_sync   cada envio do robô (janela de datas e quantas linhas)
-- O robô das movimentações (robo/atualizar-movimentos.ps1) manda a
-- janela dos últimos dias; a função troca a janela inteira — assim um
-- movimento estornado no ERP some daqui também.
-- Antes: sql/sync-saldo-erp.sql (usa as funções _celula_*).
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

create table if not exists erp_mov (
  id             bigserial primary key,
  filial         text not null,
  sequencia      text,
  tipo_mov       text not null,          -- Entrada | Saída | Entrada Interna | Saída Interna
  tipo_prod      text,
  codigo         text not null,
  descricao      text,
  quantidade     numeric,
  um             text,
  lote           text not null default '',
  dt_validade    date,
  armazem        text not null default '',
  volumes        numeric,
  paletes        numeric,
  valor          numeric,
  cli_cod        text,
  cli_loja       text,
  cli_nome       text,
  cli_uf         text,
  nf             text,
  serie          text,
  tipo_nf        text,
  emissao        date not null,
  cc             text,
  cfop           text,
  tes            text,
  tes_desc       text,
  usuario        text,
  movest         boolean,
  numsa          text,
  pedido         text,
  usuario_import text,
  importado_em   timestamptz not null default now()
);
-- Fabricação do lote no movimento (vem se a consulta do ERP tiver a
-- coluna "Data de Fabricação"; sem ela fica vazia).
alter table erp_mov add column if not exists dt_fabricacao date;
create index if not exists erp_mov_emissao on erp_mov (emissao);
create index if not exists erp_mov_lote    on erp_mov (codigo, lote);
create index if not exists erp_mov_pedido  on erp_mov (pedido);

create table if not exists erp_mov_sync (
  id      bigserial primary key,
  quando  timestamptz not null default now(),
  de      date,
  ate     date,
  linhas  int,
  filiais text[],
  origem  text
);

create or replace function importar_erp_mov(linhas jsonb, p_de date, p_ate date, p_filiais text[] default null, origem text default 'robô movimentações')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if p_de is null or p_ate is null or p_de > p_ate then
    raise exception 'janela de datas inválida (% a %)', p_de, p_ate;
  end if;
  if linhas is null or jsonb_typeof(linhas) <> 'array' then
    raise exception 'linhas tem que ser uma lista (pode ser vazia)';
  end if;

  -- Troca a janela inteira das filiais configuradas.
  delete from erp_mov
  where emissao between p_de and p_ate
    and (p_filiais is null or cardinality(p_filiais) = 0 or filial = any(p_filiais));

  insert into erp_mov (filial, sequencia, tipo_mov, tipo_prod, codigo, descricao, quantidade, um, lote, dt_validade, dt_fabricacao, armazem,
                       volumes, paletes, valor, cli_cod, cli_loja, cli_nome, cli_uf, nf, serie, tipo_nf, emissao, cc, cfop,
                       tes, tes_desc, usuario, movest, numsa, pedido, usuario_import)
  select
    case when _celula_txt(l->'FILIAL') ~ '^\d{1,5}$' then lpad(_celula_txt(l->'FILIAL'), 6, '0') else _celula_txt(l->'FILIAL') end,
    nullif(_celula_txt(l->'SEQ'), ''),
    btrim(coalesce(l->>'TIPO_MOV', '')),
    nullif(upper(_celula_txt(l->'TIPO_PROD')), ''),
    case when _celula_txt(l->'COD') ~ '^\d{1,10}$' then lpad(_celula_txt(l->'COD'), 11, '0') else upper(_celula_txt(l->'COD')) end,
    nullif(regexp_replace(btrim(coalesce(l->>'DESC', '')), '\s+', ' ', 'g'), ''),
    _celula_num(l->'QTD'),
    nullif(upper(_celula_txt(l->'UM')), ''),
    upper(_celula_txt(l->'LOTE')),
    _celula_data(l->'VALIDADE'),
    _celula_data(l->'FABRICACAO'),
    upper(regexp_replace(_celula_txt(l->'ARM'), '\s+', '', 'g')),
    _celula_num(l->'VOL'),
    _celula_num(l->'PAL'),
    _celula_num(l->'VALOR'),
    nullif(_celula_txt(l->'CLI_COD'), ''),
    nullif(_celula_txt(l->'CLI_LOJA'), ''),
    nullif(regexp_replace(btrim(coalesce(l->>'CLI_NOME', '')), '\s+', ' ', 'g'), ''),
    nullif(upper(_celula_txt(l->'CLI_UF')), ''),
    nullif(_celula_txt(l->'NF'), ''),
    nullif(_celula_txt(l->'SERIE'), ''),
    nullif(_celula_txt(l->'TIPO_NF'), ''),
    _celula_data(l->'EMISSAO'),
    nullif(_celula_txt(l->'CC'), ''),
    nullif(_celula_txt(l->'CFOP'), ''),
    nullif(_celula_txt(l->'TES'), ''),
    nullif(regexp_replace(btrim(coalesce(l->>'TES_DESC', '')), '\s+', ' ', 'g'), ''),
    nullif(lower(_celula_txt(l->'USUARIO')), ''),
    case upper(_celula_txt(l->'MOVEST')) when 'SIM' then true when 'NAO' then false when 'NÃO' then false else null end,
    nullif(_celula_txt(l->'NUMSA'), ''),
    nullif(_celula_txt(l->'PEDIDO'), ''),
    nullif(lower(_celula_txt(l->'USU_IMPORT')), '')
  from jsonb_array_elements(linhas) as l
  where _celula_txt(l->'COD') <> '' and _celula_data(l->'EMISSAO') between p_de and p_ate;
  get diagnostics n = row_count;

  insert into erp_mov_sync (de, ate, linhas, filiais, origem) values (p_de, p_ate, n, p_filiais, origem);
  delete from erp_mov where emissao < current_date - 800;
  return jsonb_build_object('linhas', n, 'de', p_de, 'ate', p_ate);
end;
$$;

revoke execute on function importar_erp_mov(jsonb, date, date, text[], text) from public, anon, authenticated;
grant  execute on function importar_erp_mov(jsonb, date, date, text[], text) to service_role;

-- Leitura pelo painel (mesmo acesso das outras tabelas do sistema).
alter table erp_mov enable row level security;
drop policy if exists "leitura do sistema" on erp_mov;
create policy "leitura do sistema" on erp_mov for select to anon, authenticated using (true);
grant select on erp_mov to anon, authenticated;

alter table erp_mov_sync enable row level security;
drop policy if exists "leitura do sistema" on erp_mov_sync;
create policy "leitura do sistema" on erp_mov_sync for select to anon, authenticated using (true);
grant select on erp_mov_sync to anon, authenticated;

notify pgrst, 'reload schema';
