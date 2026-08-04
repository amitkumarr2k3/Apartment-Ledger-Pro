-- 0006_drop_etl_sessions.sql
-- Cleanup: remove ETL-specific tracking table and rely on import_batches/import_staging.

BEGIN;

DROP TABLE IF EXISTS etl_sessions;

COMMIT;
