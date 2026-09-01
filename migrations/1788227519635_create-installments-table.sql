-- Up Migration

CREATE TABLE installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  installment_number SMALLINT NOT NULL CHECK (installment_number >= 1),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, installment_number)
);

CREATE INDEX idx_installments_purchase_id ON installments(purchase_id);
CREATE INDEX idx_installments_invoice_id ON installments(invoice_id);

-- Down Migration

DROP TABLE installments;
