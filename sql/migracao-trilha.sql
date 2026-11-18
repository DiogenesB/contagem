-- ═══════════════════════════════════════════════════════════════
-- TRILHA: nomes unificados, quem guardou cada item e o vínculo das
-- ocupações com a linha do mapa
--
--   1. Apelidos antigos viram o nome do usuário (Gabriel Brodt →
--      Gabriel Brodtt, ROBERTO → Roberto Elvino, ...), em todas as
--      tabelas que guardam nome de pessoa
--   2. historico.guardado_por / guardado_em: quem pôs o item na vaga
--      atual e quando (tirado da trilha de Alterações)
--   3. alteracoes.ref_id das ocupações antigas: aponta para a linha
--      do mapa que a ocupação criou
--   4. Daqui para frente o banco preenche sozinho (gatilhos): toda
--      linha nova no mapa ou movida de vaga ganha guardado_por, e toda
--      ocupação registrada sem vínculo é ligada à linha certa
--
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Apelidos → nome do usuário ──
-- "GABRIEL" (117 registros, 08/10 a 09/11, quase tudo "expediu") era
-- o Gabriel Brodtt, que faz a expedição. Se não for, troque abaixo
-- antes de rodar.
do $$
declare c record; n int;
  -- de → para (troque aqui se algum estiver errado)
  ap constant text[][] := array[
    ['Gabriel Brodt',               'Gabriel Brodtt'],
    ['GABRIEL',                     'Gabriel Brodtt'],
    ['ROBERTO',                     'Roberto Elvino'],
    ['Diogenes Bruno Souza Santos', 'Diogenes Santos'],
    ['DIOGENES BRUNO SOUZA SANTOS', 'Diogenes Santos'],
    ['DIOGENES',                    'Diogenes Santos'],
    ['diogenes',                    'Diogenes Santos']];
  i int;
begin
  for c in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying')
      and column_name in ('quem', 'usuario', 'feito_por', 'resolvido_por', 'separado_por', 'finalizado_por',
                          'concluido_por', 'desfeito_por', 'atualizado_por', 'guardado_por')
      and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    for i in 1 .. array_length(ap, 1) loop
      execute format('update %I set %I = $1 where %I = $2', c.table_name, c.column_name, c.column_name) using ap[i][2], ap[i][1];
      get diagnostics n = row_count;
      if n > 0 then raise notice '%.%: % "%" → "%"', c.table_name, c.column_name, n, ap[i][1], ap[i][2]; end if;
    end loop;
  end loop;
end $$;

-- ── 2. Colunas novas no mapa ──
alter table historico add column if not exists guardado_por text;
alter table historico add column if not exists guardado_em  timestamptz;

-- ── 3. Ocupações antigas sem vínculo: a linha do mapa da mesma vaga e
--       lote, criada até 5 min antes/depois do registro (a mais próxima) ──
with par as (
  select distinct on (a.id) a.id as alt_id, h.id as hist_id
  from alteracoes a
  join historico h on h.posicao = a.posicao
   and upper(btrim(coalesce(h.lote, ''))) = upper(btrim(coalesce(a.lote, '')))
   and abs(extract(epoch from (h.created_at - a.created_at))) <= 300
  where a.acao = 'ocupou' and a.ref_id is null and coalesce(a.tabela_ref, 'historico') = 'historico'
  order by a.id, abs(extract(epoch from (h.created_at - a.created_at)))
)
update alteracoes a set ref_id = par.hist_id from par where par.alt_id = a.id;   -- ref_id pode ser texto ou número

-- ── 4. Quem guardou cada linha ativa: o último "ocupou"/"moveu" da linha
--       (ou "retornou" da separação para a mesma vaga e lote) ──
with ev as (
  select distinct on (h.id) h.id, a.quem, a.created_at
  from historico h
  join alteracoes a on (
        (a.acao in ('ocupou', 'moveu') and a.ref_id::text = h.id::text)
     or (a.acao = 'retornou' and a.posicao = h.posicao
         and upper(btrim(coalesce(a.lote, ''))) = upper(btrim(coalesce(h.lote, '')))
         and abs(extract(epoch from (h.created_at - a.created_at))) <= 300))
  where h.ocupacao_ativa = true and h.posicao is not null
    and coalesce(a.quem, '') not in ('', 'sem nome', 'automático')
  order by h.id, a.created_at desc
)
update historico h set guardado_por = ev.quem, guardado_em = ev.created_at
from ev where ev.id = h.id and h.guardado_por is null;

-- Sem trilha com nome: fica o usuário que criou a linha (se não for "painel").
update historico set guardado_por = usuario, guardado_em = coalesce(guardado_em, created_at)
where guardado_por is null and ocupacao_ativa = true and posicao is not null
  and coalesce(usuario, '') not in ('', 'painel', 'sem nome');
update historico set guardado_em = created_at
where guardado_em is null and ocupacao_ativa = true and posicao is not null;

-- ── 5. Daqui para frente ──
-- Linha nova no mapa, ou que mudou de vaga: quem fez guardou.
create or replace function historico_guardado() returns trigger
language plpgsql as $$
begin
  if new.posicao is not null and coalesce(new.ocupacao_ativa, false)
     and (tg_op = 'INSERT' or new.posicao is distinct from old.posicao or (new.ocupacao_ativa and not coalesce(old.ocupacao_ativa, false))) then
    new.guardado_por := coalesce(nullif(new.feito_por, ''), nullif(nullif(new.usuario, ''), 'painel'), new.guardado_por);
    new.guardado_em  := now();
  end if;
  return new;
end $$;
drop trigger if exists historico_guardado on historico;
create trigger historico_guardado before insert or update of posicao, ocupacao_ativa on historico
  for each row execute function historico_guardado();

-- Ocupação registrada sem o id da linha: liga à linha da mesma vaga e
-- lote criada nos últimos 5 min; e o nome dela vira o "quem guardou".
create or replace function alteracao_vinculo() returns trigger
language plpgsql as $$
declare hid bigint;
begin
  if new.acao = 'ocupou' and new.ref_id is null and coalesce(new.tabela_ref, 'historico') = 'historico' then
    select h.id into hid from historico h
    where h.posicao = new.posicao
      and upper(btrim(coalesce(h.lote, ''))) = upper(btrim(coalesce(new.lote, '')))
      and h.created_at >= now() - interval '5 minutes'
    order by h.created_at desc limit 1;
    if hid is not null then new.ref_id := hid; end if;
  end if;
  if new.acao in ('ocupou', 'moveu') and new.ref_id is not null
     and coalesce(new.tabela_ref, 'historico') = 'historico' and coalesce(new.quem, '') not in ('', 'sem nome') then
    update historico set guardado_por = new.quem where id::text = new.ref_id::text and guardado_por is distinct from new.quem;
  end if;
  return new;
end $$;
drop trigger if exists alteracao_vinculo on alteracoes;
create trigger alteracao_vinculo before insert on alteracoes
  for each row execute function alteracao_vinculo();

notify pgrst, 'reload schema';

-- Conferir:
-- select quem, count(*) from alteracoes group by 1 order by 2 desc;
-- select guardado_por, count(*) from historico where ocupacao_ativa group by 1 order by 2 desc;
-- select count(*) filter (where ref_id is null) as sem_vinculo, count(*) from alteracoes where acao = 'ocupou';
