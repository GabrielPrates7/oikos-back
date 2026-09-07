-- Up Migration

ALTER TABLE expenses ADD COLUMN is_paid BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE expenses ADD COLUMN is_planned BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE expenses ADD COLUMN paid_date DATE;

ALTER TABLE income_entries ADD COLUMN is_received BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE income_entries ADD COLUMN is_planned BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE income_entries ADD COLUMN received_date DATE;

-- Down Migration

ALTER TABLE income_entries DROP COLUMN received_date;
ALTER TABLE income_entries DROP COLUMN is_planned;
ALTER TABLE income_entries DROP COLUMN is_received;

ALTER TABLE expenses DROP COLUMN paid_date;
ALTER TABLE expenses DROP COLUMN is_planned;
ALTER TABLE expenses DROP COLUMN is_paid;
