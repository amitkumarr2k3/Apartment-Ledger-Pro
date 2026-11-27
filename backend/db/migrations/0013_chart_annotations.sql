CREATE TABLE IF NOT EXISTS chart_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  chart_key TEXT NOT NULL,
  point_key TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  comment TEXT NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 4000),
  visibility TEXT NOT NULL CHECK (visibility IN ('all', 'resident', 'admin')),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (community_id, chart_key, point_key)
);

CREATE INDEX IF NOT EXISTS chart_annotations_lookup_idx
  ON chart_annotations (community_id, chart_key, point_key);
