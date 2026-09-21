-- Up Migration

-- Aditiva e retrocompatível: o backend ANTERIOR continua funcionando com este esquema (os INSERTs
-- dele listam colunas explicitamente e estas têm DEFAULT/NULL; os SELECT * só ganham campos extras).
-- Sem backfill: linhas existentes ficam is_fixed = false e notes = NULL.

-- Recorrência ("fixa") de entradas — espelha expenses.is_fixed / purchases.is_fixed.
ALTER TABLE income_entries ADD COLUMN is_fixed BOOLEAN NOT NULL DEFAULT false;

-- Observação livre (opcional), até 500 caracteres (char_length conta caracteres, não bytes; o
-- backend valida por pontos de código, o mesmo cálculo).
ALTER TABLE income_entries ADD COLUMN notes TEXT NULL
  CONSTRAINT income_entries_notes_length_check CHECK (notes IS NULL OR char_length(notes) <= 500);
ALTER TABLE expenses ADD COLUMN notes TEXT NULL
  CONSTRAINT expenses_notes_length_check CHECK (notes IS NULL OR char_length(notes) <= 500);
ALTER TABLE purchases ADD COLUMN notes TEXT NULL
  CONSTRAINT purchases_notes_length_check CHECK (notes IS NULL OR char_length(notes) <= 500);

-- Down Migration

-- Remover a coluna remove também a CHECK constraint dela. ATENÇÃO: descarta as observações e a
-- recorrência de entradas gravadas depois do up.
ALTER TABLE purchases DROP COLUMN notes;
ALTER TABLE expenses DROP COLUMN notes;
ALTER TABLE income_entries DROP COLUMN notes;
ALTER TABLE income_entries DROP COLUMN is_fixed;
