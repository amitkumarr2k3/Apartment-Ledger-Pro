CREATE TABLE IF NOT EXISTS expense_info_settings (
  community_id UUID PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  procurement_names TEXT[] NOT NULL DEFAULT ARRAY['One Time Operational Procurement']::TEXT[],
  CHECK (cardinality(procurement_names) BETWEEN 1 AND 50),
  CHECK (array_position(procurement_names, NULL) IS NULL)
);