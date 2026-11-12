-- ═══════════════════════════════════════════════════════════════
-- INTELIGÊNCIA DO SALDO
--   estoque_ref_mov        o "filme": a cada envio do robô (ou import
--                          manual), o que mudou em cada lote+armazém
--                          (entrou, saiu, aumentou, diminuiu)
--   inteligencia_decisao   o que você fez com cada sugestão (aplicou,
--                          recusou, adiou) — o sistema aprende com isso
--                          e dá para desfazer o que foi aplicado
-- Antes: sql/migracao-saldo-historico.sql (esta troca a função
-- registrar_saldo_diario por uma versão que também grava o filme).
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

create table if not exists estoque_ref_mov (
  id           bigserial primary key,
  quando       timestamptz not null default now(),
  filial       text    not null default '',
  codigo       text    not null,
  lote         text    not null default '',
  armazem      text    not null default '',
  saldo_antes  numeric not null default 0,
  saldo_depois numeric not null default 0,
  delta        numeric not null,
  tipo         text    not null check (tipo in ('entrou', 'saiu', 'aumentou', 'diminuiu'))
);
create index if not exists estoque_ref_mov_quando on estoque_ref_mov (quando);
create index if not exists estoque_ref_mov_lote   on estoque_ref_mov (codigo, lote);

create table if not exists inteligencia_decisao (
  id        bigserial primary key,
  quando    timestamptz not null default now(),
  quem      text,
  chave     text not null,             -- a sugestão (tipo + lote + armazém + números)
  tipo      text not null,             -- lote-digitado, saiu-nao-baixado, ...
  decisao   text not null check (decisao in ('aplicou', 'recusou', 'adiou', 'desfez')),
  ate       timestamptz,               -- adiou: volta a aparecer depois disso
  detalhes  jsonb                      -- o que foi mudado (para desfazer) e as pistas
);
create index if not exists inteligencia_decisao_quando on inteligencia_decisao (quando);
create index if not exists inteligencia_decisao_chave  on inteligencia_decisao (chave);

-- Mesmo acesso das outras tabelas do sistema (chave publicável).
alter table estoque_ref_mov enable row level security;
drop policy if exists "leitura do sistema" on estoque_ref_mov;
create policy "leitura do sistema" on estoque_ref_mov for select to anon, authenticated using (true);
grant select on estoque_ref_mov to anon, authenticated;

alter table inteligencia_decisao enable row level security;
drop policy if exists "acesso do sistema" on inteligencia_decisao;
create policy "acesso do sistema" on inteligencia_decisao for all to anon, authenticated using (true) with check (true);
grant select, insert, update on inteligencia_decisao to anon, authenticated;
grant usage, select on sequence inteligencia_decisao_id_seq to anon, authenticated;

-- ── registrar_saldo_diario, agora com o filme ──
-- Igual à de migracao-saldo-historico.sql, mais o passo 2 (filme).
create or replace function registrar_saldo_diario()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nd int; nl int; nm int := 0;
  tinha boolean;
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

  -- Foto de agora por lote+armazém (só o que tem saldo).
  drop table if exists _atual;
  create temp table _atual on commit drop as
    select coalesce(btrim(filial), '')                               as filial,
           codigo,
           upper(btrim(coalesce(lote, '')))                          as lote,
           upper(regexp_replace(coalesce(armazem, ''), '\s+', '', 'g')) as armazem,
           round(sum(coalesce(saldo, 0)), 4)                         as saldo,
           round(sum(empenho), 4)                                    as empenho
    from estoque_ref
    where coalesce(codigo, '') <> ''
    group by 1, 2, 3, 4
    having round(sum(coalesce(saldo, 0)), 4) <> 0;

  -- 2. Filme: compara com o envio anterior (estoque_ref_lote ainda tem
  --    a foto de antes). Na primeira vez não grava nada — senão tudo
  --    pareceria "entrou agora".
  select exists (select 1 from estoque_ref_lote) into tinha;
  if tinha then
    insert into estoque_ref_mov (filial, codigo, lote, armazem, saldo_antes, saldo_depois, delta, tipo)
    select coalesce(a.filial, e.filial), coalesce(a.codigo, e.codigo), coalesce(a.lote, e.lote), coalesce(a.armazem, e.armazem),
           coalesce(e.saldo, 0), coalesce(a.saldo, 0), coalesce(a.saldo, 0) - coalesce(e.saldo, 0),
           case when e.codigo is null then 'entrou'
                when a.codigo is null then 'saiu'
                when a.saldo > e.saldo then 'aumentou'
                else 'diminuiu' end
    from _atual a
    full join estoque_ref_lote e
      on e.filial = a.filial and e.codigo = a.codigo and e.lote = a.lote and e.armazem = a.armazem
    where coalesce(a.saldo, 0) is distinct from coalesce(e.saldo, 0);
    get diagnostics nm = row_count;
  end if;
  delete from estoque_ref_mov where quando < now() - interval '400 days';

  -- 3. Lotes: o que tem saldo agora. Saldo diferente do último
  --    envio = o lote mexeu (entrou, saiu, faturou, transferiu).
  insert into estoque_ref_lote as e (filial, codigo, lote, armazem, saldo, empenho)
  select filial, codigo, lote, armazem, saldo, empenho from _atual
  on conflict (filial, codigo, lote, armazem) do update
    set ultima_mudanca = case when e.saldo is distinct from excluded.saldo then now() else e.ultima_mudanca end,
        saldo    = excluded.saldo,
        empenho  = excluded.empenho,
        visto_em = now();
  get diagnostics nl = row_count;

  -- Saiu da foto (zerou ou mudou de armazém): sai daqui também.
  delete from estoque_ref_lote l
  where not exists (
    select 1 from _atual a
    where a.filial = l.filial and a.codigo = l.codigo and a.lote = l.lote and a.armazem = l.armazem);

  return jsonb_build_object('dia', hoje, 'resumo', nd, 'lotes', nl, 'movimentos', nm);
end;
$$;

grant execute on function registrar_saldo_diario() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
