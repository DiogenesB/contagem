-- ═══════════════════════════════════════════════════════════════
-- TELA "SALDO" DO PAINEL — histórico do saldo do ERP
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
--
-- O saldo do ERP (estoque_ref) é uma foto: cada importação apaga a
-- anterior. Para ver a evolução e os lotes parados, toda vez que a
-- foto muda a função registrar_saldo_diario() guarda:
--
--   estoque_ref_dia   um resumo por dia × filial × armazém × unidade
--                     × tipo (o último envio do dia é o que fica).
--                     Pequeno: ~150 linhas por dia.
--   estoque_ref_lote  cada lote+armazém que tem saldo agora, com o
--                     dia em que apareceu e o dia em que o saldo
--                     mudou pela última vez → "parado há N dias".
--
-- Quem chama: o robô (no fim do importar_estoque_ref) e o painel,
-- depois da importação manual no Saldo mapeado.
-- O histórico começa no dia em que esta migração rodar.
-- ═══════════════════════════════════════════════════════════════

-- Colunas da planilha SB8_SALDOS_LOTES que a tela usa.
alter table estoque_ref add column if not exists tipo          text;
alter table estoque_ref add column if not exists empenho       numeric;
alter table estoque_ref add column if not exists dt_fabricacao date;
alter table estoque_ref add column if not exists dt_validade   date;
alter table estoque_ref add column if not exists paletes       numeric;   -- PALETES
alter table estoque_ref add column if not exists caixas        numeric;   -- CXs

create table if not exists estoque_ref_dia (
  dia           date    not null,
  filial        text    not null default '',
  armazem       text    not null default '',
  unidade       text    not null default '',
  tipo          text    not null default '',
  saldo         numeric not null default 0,
  empenho       numeric not null default 0,
  vencido       numeric not null default 0,   -- parte do saldo já vencida naquele dia
  paletes       numeric,
  lotes         int     not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (dia, filial, armazem, unidade, tipo)
);

create table if not exists estoque_ref_lote (
  filial         text    not null default '',
  codigo         text    not null,
  lote           text    not null default '',
  armazem        text    not null default '',
  saldo          numeric not null default 0,
  empenho        numeric,
  primeiro_visto timestamptz not null default now(),
  ultima_mudanca timestamptz not null default now(),
  visto_em       timestamptz not null default now(),
  primary key (filial, codigo, lote, armazem)
);
create index if not exists estoque_ref_lote_mudanca on estoque_ref_lote (ultima_mudanca);

create or replace function registrar_saldo_diario()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nd int; nl int;
begin
  -- Robô e importação manual ao mesmo tempo: um espera o outro.
  perform pg_advisory_xact_lock(hashtext('registrar_saldo_diario'));

  -- 1. Resumo do dia: a foto de agora substitui a de mais cedo.
  delete from estoque_ref_dia where dia = hoje;
  insert into estoque_ref_dia (dia, filial, armazem, unidade, tipo, saldo, empenho, vencido, paletes, lotes)
  select hoje,
         coalesce(btrim(filial), ''),
         upper(regexp_replace(coalesce(armazem, ''), '\s+', '', 'g')),
         upper(btrim(coalesce(unidade, ''))),
         upper(btrim(coalesce(tipo, ''))),
         coalesce(sum(saldo), 0),
         coalesce(sum(empenho), 0),
         coalesce(sum(saldo) filter (where dt_validade < hoje), 0),
         sum(paletes),
         count(*) filter (where coalesce(saldo, 0) <> 0)
  from estoque_ref
  group by 2, 3, 4, 5;
  get diagnostics nd = row_count;

  -- 2. Lotes: o que tem saldo agora. Saldo diferente do último
  --    envio = o lote mexeu (entrou, saiu, faturou, transferiu).
  with atual as (
    select coalesce(btrim(filial), '')                               as filial,
           codigo,
           upper(btrim(coalesce(lote, '')))                          as lote,
           upper(regexp_replace(coalesce(armazem, ''), '\s+', '', 'g')) as armazem,
           round(sum(coalesce(saldo, 0)), 4)                         as saldo,
           round(sum(empenho), 4)                                    as empenho
    from estoque_ref
    where coalesce(codigo, '') <> ''
    group by 1, 2, 3, 4
    having round(sum(coalesce(saldo, 0)), 4) <> 0
  )
  insert into estoque_ref_lote as e (filial, codigo, lote, armazem, saldo, empenho)
  select filial, codigo, lote, armazem, saldo, empenho from atual
  on conflict (filial, codigo, lote, armazem) do update
    set ultima_mudanca = case when e.saldo is distinct from excluded.saldo then now() else e.ultima_mudanca end,
        saldo    = excluded.saldo,
        empenho  = excluded.empenho,
        visto_em = now();
  get diagnostics nl = row_count;

  -- Saiu da foto (zerou ou mudou de armazém): sai daqui também.
  delete from estoque_ref_lote l
  where not exists (
    select 1 from estoque_ref r
    where coalesce(btrim(r.filial), '') = l.filial
      and r.codigo = l.codigo
      and upper(btrim(coalesce(r.lote, ''))) = l.lote
      and upper(regexp_replace(coalesce(r.armazem, ''), '\s+', '', 'g')) = l.armazem
      and coalesce(r.saldo, 0) <> 0);

  return jsonb_build_object('dia', hoje, 'resumo', nd, 'lotes', nl);
end;
$$;

-- A chave publicável do painel pode chamar: a função só lê a foto
-- atual e reescreve o histórico de hoje.
grant execute on function registrar_saldo_diario() to anon, authenticated, service_role;

-- Leitura pela tela (mesmo acesso das outras tabelas do sistema).
-- Escrita só pela função acima.
grant select on estoque_ref_dia, estoque_ref_lote to anon, authenticated;
alter table estoque_ref_dia  enable row level security;
alter table estoque_ref_lote enable row level security;
drop policy if exists "leitura do sistema" on estoque_ref_dia;
drop policy if exists "leitura do sistema" on estoque_ref_lote;
create policy "leitura do sistema" on estoque_ref_dia  for select to anon, authenticated using (true);
create policy "leitura do sistema" on estoque_ref_lote for select to anon, authenticated using (true);

-- Primeira foto: começa o histórico hoje com o saldo que já está lá.
select registrar_saldo_diario();

notify pgrst, 'reload schema';
