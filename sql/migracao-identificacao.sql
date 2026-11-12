-- ═══════════════════════════════════════════════════════════════
-- IDENTIFICAÇÃO DO PALETE
-- Guarda fabricação e validade do lote na foto do Saldo mapeado,
-- para a identificação do palete preencher as datas sozinha.
-- Rode uma vez no SQL Editor do Supabase. Pode rodar de novo.
--
-- Depois de rodar, importe os armazéns de novo no Saldo mapeado
-- (as datas só entram nas importações feitas a partir de agora).
-- ═══════════════════════════════════════════════════════════════

alter table estoque_ref add column if not exists dt_fabricacao date;
alter table estoque_ref add column if not exists dt_validade   date;

-- O saldo da contagem (Validação) já guarda as duas; garante que existem.
alter table saldo_sistema add column if not exists dt_fabricacao date;
alter table saldo_sistema add column if not exists dt_validade   date;

-- Busca da identificação: produto + lote.
create index if not exists estoque_ref_codigo_lote on estoque_ref (codigo, lote);

notify pgrst, 'reload schema';
