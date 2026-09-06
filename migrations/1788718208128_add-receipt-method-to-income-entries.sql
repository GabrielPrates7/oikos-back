-- Up Migration

ALTER TABLE income_entries
  ADD COLUMN receipt_method TEXT NOT NULL DEFAULT 'transfer'
    CHECK (receipt_method IN ('pix', 'transfer', 'cash', 'other'));

-- Down Migration

ALTER TABLE income_entries DROP COLUMN receipt_method;
