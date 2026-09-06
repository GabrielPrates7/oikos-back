-- Up Migration

CREATE TABLE financial_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount_cents INTEGER NOT NULL CHECK (target_amount_cents > 0),
  target_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_goals_user_id ON financial_goals(user_id);

CREATE TRIGGER set_financial_goals_updated_at
  BEFORE UPDATE ON financial_goals
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE financial_goals;
