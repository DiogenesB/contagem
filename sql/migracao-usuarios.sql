-- ═══════════════════════════════════════════════════════════════
-- USUÁRIOS (sem senha)
-- Não é login de segurança: é a lista de quem usa o sistema, para
-- cada alteração ter dono e para mostrar a cada um só o que ele usa.
--   perfil: gestor | assistente        (aparece ao lado do nome)
--   acesso: total  | mapa              (mapa = só o mapa.html)
-- Os gestores mantêm a lista pelo painel (menu do usuário → Usuários).
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

create table if not exists usuarios (
  login       text primary key check (login = lower(btrim(login)) and login <> ''),
  nome        text not null,
  perfil      text not null default 'assistente' check (perfil in ('gestor', 'assistente')),
  acesso      text not null default 'total'      check (acesso in ('total', 'mapa')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz,
  alterado_por text
);

insert into usuarios (login, nome, perfil, acesso) values
  ('diogenes.santos', 'Diogenes Santos', 'gestor',     'total'),
  ('jeferson.habby',  'Jeferson Habby',  'gestor',     'total'),
  ('gabriel.farias',  'Gabriel Farias',  'assistente', 'total'),
  ('roberto.elvino',  'Roberto Elvino',  'assistente', 'total'),
  ('gabriel.brodtt',  'Gabriel Brodtt',  'assistente', 'mapa')
on conflict (login) do nothing;

-- Mesmo acesso das outras tabelas do sistema (chave publicável).
grant select, insert, update, delete on usuarios to anon, authenticated;
alter table usuarios enable row level security;
drop policy if exists "acesso do sistema" on usuarios;
create policy "acesso do sistema" on usuarios for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
