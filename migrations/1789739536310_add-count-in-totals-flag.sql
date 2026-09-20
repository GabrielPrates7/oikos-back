-- Up Migration

-- Default true: todo dado existente continua contando normalmente (sem mudança
-- retroativa). Só métricas de análise (Total exibido nesta fase; Dashboard/Relatórios na
-- fase 2) filtram por esse campo — Saldo Real e o extrato de conta NUNCA olham pra ele,
-- de propósito (refletem 100% do dinheiro real, marcado ou não).
ALTER TABLE income_entries ADD COLUMN count_in_totals BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE expenses ADD COLUMN count_in_totals BOOLEAN NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE expenses DROP COLUMN count_in_totals;
ALTER TABLE income_entries DROP COLUMN count_in_totals;
