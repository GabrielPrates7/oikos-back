-- Up Migration
-- Plano do mês: planejamento mensal de entradas e saídas. Migração ADITIVA: só cria tabelas novas,
-- nenhuma tabela existente é alterada. Dinheiro em centavos inteiros; datas como DATE.

CREATE TABLE monthly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Sempre o primeiro dia do mês (mesma convenção de budgets.reference_month).
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  include_opening_balance BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, month),
  -- Alvo do FK composto de plan_items: garante que a linha e o plano são do MESMO usuário.
  UNIQUE (id, user_id)
);

CREATE TRIGGER set_monthly_plans_updated_at
  BEFORE UPDATE ON monthly_plans
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  -- Linha manual: descrição, categoria e is_essential vivem aqui. Linha vinculada: ficam NULL e são
  -- derivados do lançamento na leitura (não envelhecem se o lançamento for editado).
  description TEXT CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 200),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  -- NULL só para linha de fatura (valor dinâmico = total atual da fatura); nas demais, > 0.
  planned_amount_cents INTEGER CHECK (planned_amount_cents IS NULL OR planned_amount_cents > 0),
  planned_date DATE,
  is_essential BOOLEAN,
  income_entry_id UUID REFERENCES income_entries(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, user_id) REFERENCES monthly_plans (id, user_id) ON DELETE CASCADE,
  -- No máximo uma origem (nenhuma = linha manual).
  CONSTRAINT plan_items_single_source_check
    CHECK (num_nonnulls(income_entry_id, expense_id, invoice_id) <= 1),
  -- Coerência do tipo com a origem: entrada só com income; despesa e fatura só com expense.
  CONSTRAINT plan_items_income_source_kind_check
    CHECK (income_entry_id IS NULL OR kind = 'income'),
  CONSTRAINT plan_items_expense_source_kind_check
    CHECK ((expense_id IS NULL AND invoice_id IS NULL) OR kind = 'expense'),
  CONSTRAINT plan_items_essential_kind_check
    CHECK (is_essential IS NULL OR kind = 'expense'),
  -- Fatura <=> valor NULL (dinâmico); qualquer outra linha tem valor.
  CONSTRAINT plan_items_amount_invoice_check
    CHECK (
      (invoice_id IS NOT NULL AND planned_amount_cents IS NULL)
      OR (invoice_id IS NULL AND planned_amount_cents IS NOT NULL)
    ),
  -- Descrição obrigatória só em linha manual (sem origem).
  CONSTRAINT plan_items_manual_description_check
    CHECK (num_nonnulls(income_entry_id, expense_id, invoice_id) = 1 OR description IS NOT NULL)
);

CREATE INDEX idx_plan_items_plan_id ON plan_items(plan_id);
CREATE INDEX idx_plan_items_user_id ON plan_items(user_id);

-- Um lançamento ou uma fatura entra em UM plano só.
CREATE UNIQUE INDEX uq_plan_items_income_entry ON plan_items(income_entry_id)
  WHERE income_entry_id IS NOT NULL;
CREATE UNIQUE INDEX uq_plan_items_expense ON plan_items(expense_id)
  WHERE expense_id IS NOT NULL;
CREATE UNIQUE INDEX uq_plan_items_invoice ON plan_items(invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE TRIGGER set_plan_items_updated_at
  BEFORE UPDATE ON plan_items
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Down Migration
-- Remove SÓ as tabelas do Plano (e as linhas do plano). Nenhum dado de entradas, despesas ou faturas
-- é tocado.
DROP TABLE plan_items;
DROP TABLE monthly_plans;
