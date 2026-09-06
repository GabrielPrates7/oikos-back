-- Up Migration

ALTER TABLE expenses ADD COLUMN is_essential BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE expenses ADD COLUMN is_fixed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE purchases ADD COLUMN is_essential BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE purchases ADD COLUMN is_fixed BOOLEAN NOT NULL DEFAULT false;

-- Down Migration

ALTER TABLE purchases DROP COLUMN is_fixed;
ALTER TABLE purchases DROP COLUMN is_essential;

ALTER TABLE expenses DROP COLUMN is_fixed;
ALTER TABLE expenses DROP COLUMN is_essential;
