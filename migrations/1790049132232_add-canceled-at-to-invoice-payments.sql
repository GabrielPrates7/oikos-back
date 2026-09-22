-- Up Migration

-- Soft-cancel: cancelar um pagamento de fatura preserva o registro (auditoria/ledger), só marca
-- quando foi cancelado. NULL = pagamento ativo.
ALTER TABLE invoice_payments ADD COLUMN canceled_at TIMESTAMPTZ NULL DEFAULT NULL;

-- A UNIQUE(invoice_id) de tabela inteira impediria pagar a mesma fatura de novo depois de um
-- cancelamento (o registro cancelado continuaria ocupando aquele invoice_id). Troca por um índice
-- único PARCIAL: só um pagamento ATIVO por fatura ao mesmo tempo; quantos cancelados existirem no
-- histórico não importam pra essa restrição.
ALTER TABLE invoice_payments DROP CONSTRAINT invoice_payments_invoice_id_key;
CREATE UNIQUE INDEX invoice_payments_invoice_id_active_key
  ON invoice_payments(invoice_id) WHERE canceled_at IS NULL;

-- Down Migration

DROP INDEX invoice_payments_invoice_id_active_key;
ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_invoice_id_key UNIQUE (invoice_id);
ALTER TABLE invoice_payments DROP COLUMN canceled_at;
