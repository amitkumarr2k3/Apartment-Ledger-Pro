-- Add ETL tracking tables

CREATE TABLE etl_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  input_files   JSONB,
  output_files  JSONB,
  status        TEXT NOT NULL DEFAULT 'processing', -- processing|completed|failed
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (community_id, session_id)
);

CREATE INDEX etl_sessions_community_id_idx ON etl_sessions(community_id, created_at DESC);
