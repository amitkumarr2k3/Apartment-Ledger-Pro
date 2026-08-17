-- Audited Report widget: one PDF per fiscal year per community.
-- Re-uploading for the same FY replaces the previous file (see the
-- ON CONFLICT upsert in reports.ts).
CREATE TABLE IF NOT EXISTS audited_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  fiscal_year   TEXT NOT NULL,            -- e.g. "FY 2026-27" -- match whatever
                                           -- label your app's FY selector uses
  title         TEXT,
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL DEFAULT 'application/pdf',
  file_data     BYTEA NOT NULL,
  uploaded_by   UUID REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (community_id, fiscal_year)
);
