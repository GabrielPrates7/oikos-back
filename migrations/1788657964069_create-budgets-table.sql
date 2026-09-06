-- Up Migration

CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  reference_month DATE NOT NULL,
  limit_amount_cents INTEGER NOT NULL CHECK (limit_amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, reference_month)
);

CREATE INDEX idx_budgets_user_id ON budgets(user_id);

CREATE TRIGGER set_budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE budgets;
