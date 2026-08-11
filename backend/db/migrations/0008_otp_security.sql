-- 0008_otp_security.sql
-- Adds created_at (for rate-limit queries) and attempts (for brute-force
-- lockout) to otp_codes. Both columns are safe to add to existing rows.

ALTER TABLE otp_codes
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempts    INT         NOT NULL DEFAULT 0;

-- Index used by the rate-limit query: count OTPs per email in a time window.
CREATE INDEX IF NOT EXISTS idx_otp_email_created ON otp_codes (email, created_at);
