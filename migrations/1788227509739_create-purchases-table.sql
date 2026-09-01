-- Up Migration

CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_card_id UUID NOT NULL REFERENCES credit_cards(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
  installments_count SMALLINT NOT NULL CHECK (installments_count >= 1),
  purchase_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_user_id ON purchases(user_id);
CREATE INDEX idx_purchases_credit_card_id ON purchases(credit_card_id);
CREATE INDEX idx_purchases_category_id ON purchases(category_id);
CREATE INDEX idx_purchases_purchase_date ON purchases(purchase_date);

-- Down Migration

DROP TABLE purchases;
