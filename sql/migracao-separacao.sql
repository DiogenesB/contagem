-- ═══════════════════════════════════════════════════════════════
-- PEDIDOS SEPARADOS
-- O que saiu do drive-in para a área de separação e ainda não foi
-- faturado. Continua no mesmo armazém do ERP (empenhado), por isso
-- o Saldo mapeado conta como mapeado.
--
-- status: separado  → está na área de separação
--         expedido  → carregou/faturou (saiu do galpão)
--         retornado → voltou para uma vaga do drive-in
--
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
-- ═══════════════════════════════════════════════════════════════

create table if not exists separacao (
  id               bigint generated always as identity primary key,
  codigo           text not null,
  produto_nome     text,
  lote             text,
  armazem          text,
  filial           text,
  quantidade       numeric not null check (quantidade > 0),
  pedido           text,
  origem_posicao   text,            -- vaga de onde saiu (sugestão para o retorno)
  saldo_erp_antes  numeric,         -- saldo do lote+armazém na planilha do ERP na hora de separar
  foto_erp_em      timestamptz,     -- data dessa planilha
  status           text not null default 'separado' check (status in ('separado','expedido','retornado')),
  separado_por     text,
  separado_em      timestamptz not null default now(),
  finalizado_por   text,
  finalizado_em    timestamptz,
  destino_posicao  text,            -- vaga para onde voltou (retornado)
  obs              text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

create index if not exists separacao_status on separacao (status);
create index if not exists separacao_codigo_lote on separacao (codigo, lote);

-- Mesmo acesso das outras tabelas do sistema (chave publicável).
-- A política aberta funciona com o RLS ligado ou desligado.
grant select, insert, update, delete on separacao to anon, authenticated;
alter table separacao enable row level security;
drop policy if exists "acesso do sistema" on separacao;
create policy "acesso do sistema" on separacao for all to anon, authenticated using (true) with check (true);

notify pgrst, 'reload schema';
