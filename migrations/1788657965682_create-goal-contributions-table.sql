-- Up Migration

CREATE TABLE goal_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES financial_goals(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  contribution_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_goal_contributions_goal_id ON goal_contributions(goal_id);
CREATE INDEX idx_goal_contributions_account_id ON goal_contributions(account_id);

-- Down Migration

DROP TABLE goal_contributions;
