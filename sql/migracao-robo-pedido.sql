-- ═══════════════════════════════════════════════════════════════
-- ROBÔ DO SALDO · pedido manual + conferência a cada 5 minutos
-- O Agendador do Windows acorda o robô a cada 5 min. Ele pergunta aqui
-- se é a vez dele: roda quando (a) alguém apertou "Pedir ao robô" no
-- painel ou (b) já passou o intervalo desde a última rodada, dentro do
-- horário de trabalho. Rode uma vez no SQL Editor. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

create table if not exists robo_controle (
  id             int primary key default 1 check (id = 1),
  pedido_em      timestamptz,
  pedido_por     text,
  rodando_desde  timestamptz,
  ultimo_inicio  timestamptz,
  ultimo_fim     timestamptz,
  ultimo_status  text,
  ultimo_msg     text,
  ultimo_motivo  text,
  visto_em       timestamptz
);
insert into robo_controle (id) values (1) on conflict do nothing;

alter table robo_controle enable row level security;
drop policy if exists "acesso do sistema" on robo_controle;
create policy "acesso do sistema" on robo_controle for select to anon, authenticated using (true);
-- só leitura pela chave publicável; quem escreve são as funções abaixo
grant select on robo_controle to anon, authenticated;

-- Botão do painel
create or replace function pedir_atualizacao_robo(p_por text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r robo_controle;
begin
  update robo_controle set pedido_em = now(), pedido_por = nullif(btrim(p_por), '') where id = 1
    returning * into r;
  return jsonb_build_object('pedido_em', r.pedido_em, 'visto_em', r.visto_em, 'rodando', r.rodando_desde is not null);
end $$;
grant execute on function pedir_atualizacao_robo(text) to anon, authenticated, service_role;

-- O robô pergunta "é a minha vez?"
create or replace function robo_vez(p_intervalo int default 60, p_hora_ini int default 6,
                                    p_hora_fim int default 19, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r robo_controle; v_hora int; v_motivo text;
begin
  select * into r from robo_controle where id = 1 for update;
  update robo_controle set visto_em = now() where id = 1;
  v_hora := extract(hour from now() at time zone 'America/Sao_Paulo');

  -- Uma rodada por vez, mesmo a forçada: duas rodadas juntas brigam pela
  -- mesma planilha e a segunda fecharia o Excel da primeira.
  if r.rodando_desde is not null and r.rodando_desde > now() - interval '40 minutes' then
    return jsonb_build_object('rodar', false, 'motivo', 'ocupado');
  end if;

  if p_forcar then v_motivo := 'manual';
  elsif r.pedido_em is not null and (r.ultimo_inicio is null or r.pedido_em > r.ultimo_inicio) then v_motivo := 'pedido';
  elsif v_hora >= p_hora_ini and v_hora < p_hora_fim
        and (r.ultimo_fim is null or r.ultimo_fim <= now() - make_interval(mins => p_intervalo)) then v_motivo := 'agenda';
  else
    return jsonb_build_object('rodar', false, 'motivo', 'aguardando');
  end if;

  update robo_controle set rodando_desde = now(), ultimo_inicio = now(), ultimo_motivo = v_motivo where id = 1;
  return jsonb_build_object('rodar', true, 'motivo', v_motivo);
end $$;
revoke all on function robo_vez(int, int, int, boolean) from public, anon, authenticated;
grant execute on function robo_vez(int, int, int, boolean) to service_role;

create or replace function robo_fim(p_status text, p_msg text default null)
returns void language sql security definer set search_path = public as $$
  update robo_controle set rodando_desde = null, ultimo_fim = now(), ultimo_status = p_status,
         ultimo_msg = left(p_msg, 500) where id = 1;
$$;
revoke all on function robo_fim(text, text) from public, anon, authenticated;
grant execute on function robo_fim(text, text) to service_role;

-- avisa a API que tem função nova (senão o robô pode ver "função não existe" por um tempo)
notify pgrst, 'reload schema';
