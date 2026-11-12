-- ═══════════════════════════════════════════════════════════════
-- SALDO MAPEADO × SISTEMA
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo sem
-- problema (tudo é "if not exists" ou idempotente).
-- ═══════════════════════════════════════════════════════════════

-- 1) Tipo do produto (B1_TIPO) e empenho na foto do estoque.
--    Sem isto o painel funciona, só não mostra o filtro de tipo nem
--    a dica de "empenhado no ERP".
alter table estoque_ref   add column if not exists tipo    text;
alter table estoque_ref   add column if not exists empenho numeric;
alter table saldo_sistema add column if not exists tipo    text;

-- 2) Códigos que perderam o zero à esquerda (o ERP usa 11 dígitos).
--    Antes de corrigir, veja quantos são:
select 'historico' as tabela, count(*) from historico   where codigo ~ '^[0-9]{1,10}$'
union all
select 'lancamentos',          count(*) from lancamentos where codigo ~ '^[0-9]{1,10}$';

update historico   set codigo = lpad(codigo, 11, '0') where codigo ~ '^[0-9]{1,10}$';
update lancamentos set codigo = lpad(codigo, 11, '0') where codigo ~ '^[0-9]{1,10}$';

-- 3) Armazém gravado com espaço ou minúscula ("d 7" → "D7").
update historico   set armazem = upper(regexp_replace(armazem, '\s+', '', 'g'))
 where armazem is not null and armazem <> upper(regexp_replace(armazem, '\s+', '', 'g'));
update lancamentos set armazem = upper(regexp_replace(armazem, '\s+', '', 'g'))
 where armazem is not null and armazem <> upper(regexp_replace(armazem, '\s+', '', 'g'));

-- 4) Conferência: o que está no mapa com armazém fora da lista física.
--    Não corrige nada — é só para ver. Na tela, esses aparecem como
--    "Armazém trocado" (com botão para corrigir) ou "Sem saldo".
select armazem, count(*) as itens, sum(quantidade) as quantidade
  from historico
 where ocupacao_ativa = true
   and coalesce(armazem, '') not in ('42','48','49','85','91','94','98','CE','D2','D4','D5','D6','D7','D8')
 group by armazem
 order by itens desc;
