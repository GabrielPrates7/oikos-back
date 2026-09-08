-- Up Migration

ALTER TABLE accounts
  ADD COLUMN color TEXT
    CHECK (color ~ '^#[0-9a-fA-F]{6}$');

-- Down Migration

ALTER TABLE accounts DROP COLUMN color;
