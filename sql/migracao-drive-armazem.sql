-- ═══════════════════════════════════════════════════════════════
-- ARMAZÉM DE CADA LINHA DO DRIVE-IN (layout.html → aba Armazéns)
--   drive_armazem      uma linha por linha do drive-in ('B1-07'):
--                      quais armazéns podem ficar nela. Lista vazia
--                      = linha sem regra (qualquer armazém serve).
--   drive_armazem_log  quem mudou o quê e quando (gravado sozinho).
-- O layout só MOSTRA o palete que está na linha errada; não sugere
-- para onde levar. Muda-se pela própria tela (uma linha, uma faixa
-- de linhas ou colando as duas colunas da planilha).
-- Começa com a planilha "Posição dos drive in" de 11/11/2026.
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo: não
-- apaga o que já foi mudado pela tela.
-- ═══════════════════════════════════════════════════════════════

create table if not exists drive_armazem (
  linha      text primary key,                 -- estrutura-linha: 'A1-01', 'B2-36'
  armazens   text[] not null default '{}',     -- {'42'} · {'D5','D4'} · {} = sem regra
  feito_por  text,
  updated_at timestamptz not null default now()
);

create table if not exists drive_armazem_log (
  id        bigserial primary key,
  quando    timestamptz not null default now(),
  linha     text not null,
  antes     text[],
  depois    text[],
  feito_por text
);
create index if not exists drive_armazem_log_quando on drive_armazem_log (quando desc);

create or replace function drive_armazem_registrar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into drive_armazem_log (linha, antes, depois, feito_por) values (old.linha, old.armazens, null, old.feito_por);
    return old;
  end if;
  if tg_op = 'UPDATE' and new.armazens is not distinct from old.armazens then
    return new;
  end if;
  insert into drive_armazem_log (linha, antes, depois, feito_por)
  values (new.linha, case when tg_op = 'UPDATE' then old.armazens end, new.armazens, new.feito_por);
  return new;
end;
$$;

drop trigger if exists drive_armazem_log_trg on drive_armazem;
create trigger drive_armazem_log_trg after insert or update or delete on drive_armazem
for each row execute function drive_armazem_registrar();

-- Mesmo acesso das outras tabelas do mapa (layout_pavilhao, historico).
alter table drive_armazem enable row level security;
drop policy if exists "uso do sistema" on drive_armazem;
create policy "uso do sistema" on drive_armazem for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on drive_armazem to anon, authenticated;

alter table drive_armazem_log enable row level security;
drop policy if exists "leitura do sistema" on drive_armazem_log;
create policy "leitura do sistema" on drive_armazem_log for select to anon, authenticated using (true);
grant select on drive_armazem_log to anon, authenticated;

-- Quem estiver com o layout aberto vê a mudança na hora.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'drive_armazem') then
    execute 'alter publication supabase_realtime add table drive_armazem';
  end if;
end;
$$;

-- Planilha de 11/11/2026. "on conflict do nothing": rodar de novo não desfaz o que mudaram pela tela.
insert into drive_armazem (linha, armazens, feito_por) values
  ('A1-01', '{42}', 'planilha 11/11/2026'),
  ('A1-02', '{42}', 'planilha 11/11/2026'),
  ('A1-03', '{42}', 'planilha 11/11/2026'),
  ('A1-04', '{42}', 'planilha 11/11/2026'),
  ('A1-05', '{42}', 'planilha 11/11/2026'),
  ('A1-06', '{42}', 'planilha 11/11/2026'),
  ('A1-07', '{42}', 'planilha 11/11/2026'),
  ('A1-08', '{42}', 'planilha 11/11/2026'),
  ('A1-09', '{42}', 'planilha 11/11/2026'),
  ('A1-10', '{42}', 'planilha 11/11/2026'),
  ('A1-11', '{42}', 'planilha 11/11/2026'),
  ('A1-12', '{42}', 'planilha 11/11/2026'),
  ('A1-13', '{D8}', 'planilha 11/11/2026'),
  ('A1-14', '{D8}', 'planilha 11/11/2026'),
  ('A1-15', '{D2}', 'planilha 11/11/2026'),
  ('A1-16', '{D2}', 'planilha 11/11/2026'),
  ('A1-17', '{D2}', 'planilha 11/11/2026'),
  ('A1-18', '{D2}', 'planilha 11/11/2026'),
  ('A1-19', '{D2}', 'planilha 11/11/2026'),
  ('A1-20', '{D2}', 'planilha 11/11/2026'),
  ('A1-21', '{91,D7}', 'planilha 11/11/2026'),
  ('A1-22', '{D7}', 'planilha 11/11/2026'),
  ('A1-23', '{D7}', 'planilha 11/11/2026'),
  ('A1-24', '{D7}', 'planilha 11/11/2026'),
  ('A1-25', '{D7}', 'planilha 11/11/2026'),
  ('A1-26', '{94}', 'planilha 11/11/2026'),
  ('A1-27', '{94}', 'planilha 11/11/2026'),
  ('A1-28', '{94}', 'planilha 11/11/2026'),
  ('A1-29', '{94}', 'planilha 11/11/2026'),
  ('A1-30', '{94}', 'planilha 11/11/2026'),
  ('A1-31', '{94}', 'planilha 11/11/2026'),
  ('A1-32', '{94}', 'planilha 11/11/2026'),
  ('A2-29', '{42}', 'planilha 11/11/2026'),
  ('A2-30', '{42}', 'planilha 11/11/2026'),
  ('A2-31', '{D2}', 'planilha 11/11/2026'),
  ('A2-32', '{D2}', 'planilha 11/11/2026'),
  ('A2-33', '{D2}', 'planilha 11/11/2026'),
  ('A2-34', '{D2}', 'planilha 11/11/2026'),
  ('A2-35', '{D2}', 'planilha 11/11/2026'),
  ('A2-36', '{D2}', 'planilha 11/11/2026'),
  ('B1-01', '{42}', 'planilha 11/11/2026'),
  ('B1-02', '{42}', 'planilha 11/11/2026'),
  ('B1-03', '{42}', 'planilha 11/11/2026'),
  ('B1-04', '{42}', 'planilha 11/11/2026'),
  ('B1-05', '{42}', 'planilha 11/11/2026'),
  ('B1-06', '{42}', 'planilha 11/11/2026'),
  ('B1-07', '{42}', 'planilha 11/11/2026'),
  ('B1-08', '{42}', 'planilha 11/11/2026'),
  ('B1-09', '{42}', 'planilha 11/11/2026'),
  ('B1-10', '{42}', 'planilha 11/11/2026'),
  ('B1-11', '{42}', 'planilha 11/11/2026'),
  ('B1-12', '{42}', 'planilha 11/11/2026'),
  ('B1-13', '{42}', 'planilha 11/11/2026'),
  ('B1-14', '{42}', 'planilha 11/11/2026'),
  ('B1-15', '{42}', 'planilha 11/11/2026'),
  ('B1-16', '{42}', 'planilha 11/11/2026'),
  ('B1-17', '{42}', 'planilha 11/11/2026'),
  ('B1-18', '{42}', 'planilha 11/11/2026'),
  ('B1-19', '{42}', 'planilha 11/11/2026'),
  ('B1-20', '{42}', 'planilha 11/11/2026'),
  ('B1-21', '{42}', 'planilha 11/11/2026'),
  ('B1-22', '{42}', 'planilha 11/11/2026'),
  ('B1-23', '{42}', 'planilha 11/11/2026'),
  ('B1-24', '{D2}', 'planilha 11/11/2026'),
  ('B1-25', '{}', 'planilha 11/11/2026'),
  ('B1-26', '{94}', 'planilha 11/11/2026'),
  ('B1-27', '{91}', 'planilha 11/11/2026'),
  ('B1-28', '{91}', 'planilha 11/11/2026'),
  ('B1-29', '{D4,D5,D6}', 'planilha 11/11/2026'),
  ('B1-30', '{D7}', 'planilha 11/11/2026'),
  ('B1-31', '{D7}', 'planilha 11/11/2026'),
  ('B1-32', '{D7}', 'planilha 11/11/2026'),
  ('B1-33', '{D7}', 'planilha 11/11/2026'),
  ('B1-34', '{D7}', 'planilha 11/11/2026'),
  ('B1-35', '{D7}', 'planilha 11/11/2026'),
  ('B1-36', '{D7}', 'planilha 11/11/2026'),
  ('B2-01', '{D7}', 'planilha 11/11/2026'),
  ('B2-02', '{D7}', 'planilha 11/11/2026'),
  ('B2-03', '{D7}', 'planilha 11/11/2026'),
  ('B2-04', '{D7}', 'planilha 11/11/2026'),
  ('B2-05', '{D7}', 'planilha 11/11/2026'),
  ('B2-06', '{D7}', 'planilha 11/11/2026'),
  ('B2-07', '{D7}', 'planilha 11/11/2026'),
  ('B2-08', '{D5,D4}', 'planilha 11/11/2026'),
  ('B2-09', '{91}', 'planilha 11/11/2026'),
  ('B2-10', '{48}', 'planilha 11/11/2026'),
  ('B2-11', '{42}', 'planilha 11/11/2026'),
  ('B2-12', '{42}', 'planilha 11/11/2026'),
  ('B2-13', '{42}', 'planilha 11/11/2026'),
  ('B2-14', '{42}', 'planilha 11/11/2026'),
  ('B2-15', '{42}', 'planilha 11/11/2026'),
  ('B2-16', '{42}', 'planilha 11/11/2026'),
  ('B2-17', '{42}', 'planilha 11/11/2026'),
  ('B2-18', '{42}', 'planilha 11/11/2026'),
  ('B2-19', '{42}', 'planilha 11/11/2026'),
  ('B2-20', '{42}', 'planilha 11/11/2026'),
  ('B2-21', '{42}', 'planilha 11/11/2026'),
  ('B2-22', '{42}', 'planilha 11/11/2026'),
  ('B2-23', '{42}', 'planilha 11/11/2026'),
  ('B2-24', '{42}', 'planilha 11/11/2026'),
  ('B2-25', '{42}', 'planilha 11/11/2026'),
  ('B2-26', '{42}', 'planilha 11/11/2026'),
  ('B2-27', '{42}', 'planilha 11/11/2026'),
  ('B2-28', '{42}', 'planilha 11/11/2026'),
  ('B2-29', '{42}', 'planilha 11/11/2026'),
  ('B2-30', '{42}', 'planilha 11/11/2026'),
  ('B2-31', '{42}', 'planilha 11/11/2026'),
  ('B2-32', '{42}', 'planilha 11/11/2026'),
  ('B2-33', '{42}', 'planilha 11/11/2026'),
  ('B2-34', '{42}', 'planilha 11/11/2026'),
  ('B2-35', '{42}', 'planilha 11/11/2026'),
  ('B2-36', '{42}', 'planilha 11/11/2026')
on conflict (linha) do nothing;

notify pgrst, 'reload schema';
