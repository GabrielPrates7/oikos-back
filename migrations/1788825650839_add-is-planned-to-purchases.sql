-- Up Migration

ALTER TABLE purchases ADD COLUMN is_planned BOOLEAN NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE purchases DROP COLUMN is_planned;
