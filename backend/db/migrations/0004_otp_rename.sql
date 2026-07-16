-- 0004_otp_rename.sql — rename magic_links → otp_codes; drop vendor CRUD assumptions
-- The application no longer uses "magic links" (clickable one-time URLs);
-- authentication uses OTP codes emailed to whitelisted addresses.
BEGIN;

ALTER TABLE IF EXISTS magic_links RENAME TO otp_codes;

-- Vendor master remains as a reference dimension (needed for transactions and
-- vendor-insight dashboards) but no admin CRUD endpoint is exposed.
COMMENT ON TABLE vendors IS 'Vendor dimension. Read-only from admin UI; populated via CSV import + on-the-fly during transaction ingest.';

COMMIT;
