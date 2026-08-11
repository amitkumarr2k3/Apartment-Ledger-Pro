-- Add a plain-text flat code column so residents can be associated with a
-- flat number (e.g. "A-101") without requiring a flat UUID lookup.
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS flat_code TEXT;
