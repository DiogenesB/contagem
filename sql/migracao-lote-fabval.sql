-- ═══════════════════════════════════════════════════════════════
-- FABRICAÇÃO E VALIDADE DE CADA LOTE AO LONGO DO TEMPO
--   lote_fabval   cada combinação de fabricação + validade que o
--                 saldo do ERP já mostrou para um lote, com o primeiro
--                 e o último envio em que apareceu
-- O mesmo lote pode ganhar outra fabricação/validade (nova produção,
-- reanálise). O histórico do lote no painel usa isto para mostrar a
-- data certa de cada liberação.
-- Grava sozinho a cada envio do saldo (robô ou importação manual).
-- Antes: sql/sync-saldo-erp.sql. Rode uma vez no SQL Editor. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

create table if not exists lote_fabval (
  id             bigint generated always as identity primary key,
  filial         text not null default '',
  codigo         text not null,
  lote           text not null,
  dt_fabricacao  date,
  dt_validade    date,
  primeiro_visto timestamptz not null default now(),
  ultimo_visto   timestamptz not null default now()
);
create unique index if not exists lote_fabval_chave on lote_fabval
  (filial, codigo, lote, (coalesce(dt_fabricacao, date '1900-01-01')), (coalesce(dt_validade, date '1900-01-01')));
create index if not exists lote_fabval_lote on lote_fabval (codigo, lote);

create or replace function registrar_lote_fabval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into lote_fabval as f (filial, codigo, lote, dt_fabricacao, dt_validade)
  select distinct coalesce(btrim(filial), ''), codigo, upper(btrim(lote)), dt_fabricacao, dt_validade
  from estoque_ref
  where coalesce(codigo, '') <> '' and coalesce(btrim(lote), '') <> ''
    and (dt_fabricacao is not null or dt_validade is not null)
  on conflict (filial, codigo, lote, (coalesce(dt_fabricacao, date '1900-01-01')), (coalesce(dt_validade, date '1900-01-01')))
  do update set ultimo_visto = now();
  return null;
end;
$$;

drop trigger if exists lote_fabval_no_envio on estoque_ref_sync;
create trigger lote_fabval_no_envio after insert on estoque_ref_sync
  for each statement execute function registrar_lote_fabval();

-- Começa com o que o saldo mostra hoje.
insert into lote_fabval (filial, codigo, lote, dt_fabricacao, dt_validade)
select distinct coalesce(btrim(filial), ''), codigo, upper(btrim(lote)), dt_fabricacao, dt_validade
from estoque_ref
where coalesce(codigo, '') <> '' and coalesce(btrim(lote), '') <> ''
  and (dt_fabricacao is not null or dt_validade is not null)
on conflict do nothing;

-- Leitura pelo painel.
alter table lote_fabval enable row level security;
drop policy if exists "leitura do sistema" on lote_fabval;
create policy "leitura do sistema" on lote_fabval for select to anon, authenticated using (true);
grant select on lote_fabval to anon, authenticated;

-- Conferir:
-- select * from lote_fabval order by ultimo_visto desc limit 20;
