-- 0001_init.sql — full initial schema
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE communities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'INR',
  fy_start_month SMALLINT NOT NULL DEFAULT 4,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE app_role AS ENUM ('resident','admin','superadmin');

CREATE TABLE flats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  owner_email   TEXT,
  UNIQUE (community_id, code)
);

CREATE TABLE allowed_emails (
  email         TEXT PRIMARY KEY,
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  role          app_role NOT NULL,
  flat_id       UUID REFERENCES flats(id) ON DELETE SET NULL,
  name          TEXT,
  invited_by    TEXT,
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TYPE head_kind AS ENUM ('income','expense');

CREATE TABLE heads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  kind          head_kind NOT NULL,
  name          TEXT NOT NULL,
  UNIQUE (community_id, kind, name)
);

CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  head_id       UUID NOT NULL REFERENCES heads(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  UNIQUE (head_id, name)
);

CREATE TYPE vendor_kind AS ENUM ('company','individual');

CREATE TABLE vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          vendor_kind NOT NULL DEFAULT 'company',
  UNIQUE (community_id, name)
);

-- Line items are dynamic; created on-the-fly during import.
-- Non-uniform across months by design — no assumption of continuity.
CREATE TABLE line_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  vendor_id     UUID REFERENCES vendors(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  first_seen_month DATE,
  last_seen_month  DATE
);
-- Postgres does not accept expressions inside a UNIQUE table constraint,
-- so the "vendor is optional" uniqueness is enforced with a functional index.
CREATE UNIQUE INDEX line_items_cat_vendor_name_uq
  ON line_items (category_id, COALESCE(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid), name);


CREATE TABLE periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  month         DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',  -- open|closed
  UNIQUE (community_id, month)
);

CREATE TABLE balances (
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  month         DATE NOT NULL,
  opening_paise BIGINT NOT NULL DEFAULT 0,
  closing_paise BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, month)
);

CREATE TABLE transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  txn_date      DATE NOT NULL,
  period_month  DATE NOT NULL,  -- first day of month
  head_id       UUID NOT NULL REFERENCES heads(id),
  category_id   UUID NOT NULL REFERENCES categories(id),
  vendor_id     UUID REFERENCES vendors(id),
  line_item_id  UUID REFERENCES line_items(id),
  flat_id       UUID REFERENCES flats(id),
  amount_paise  BIGINT NOT NULL CHECK (amount_paise >= 0),
  direction     CHAR(1) NOT NULL CHECK (direction IN ('C','D')),
  source        TEXT NOT NULL DEFAULT 'manual',
  source_ref    TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);

CREATE TABLE collections_dues (
  flat_id       UUID NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  period_month  DATE NOT NULL,
  dues_paise    BIGINT NOT NULL DEFAULT 0,
  paid_paise    BIGINT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'due',
  PRIMARY KEY (flat_id, period_month)
);

CREATE TABLE dashboard_settings (
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  dashboard_key TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  hidden_widgets TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (community_id, dashboard_key)
);

CREATE TABLE import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  kind          TEXT NOT NULL,   -- transactions|residents|vendors
  uploaded_by   UUID REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'staged',
  error         TEXT,
  row_count     INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE import_staging (
  batch_id      UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_no        INT NOT NULL,
  raw_json      JSONB NOT NULL,
  mapped_json   JSONB,
  error         TEXT,
  PRIMARY KEY (batch_id, row_no)
);

CREATE TABLE import_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  match         JSONB NOT NULL,   -- {"col":"regex"}
  set_fields    JSONB NOT NULL,   -- {"category":"Utilities","direction":"D"}
  priority      INT NOT NULL DEFAULT 100
);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  community_id  UUID REFERENCES communities(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT,
  entity        TEXT NOT NULL,
  entity_id     TEXT,
  action        TEXT NOT NULL,     -- create|update|delete|login|import
  before        JSONB,
  after         JSONB,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            TEXT,
  user_agent    TEXT
);

CREATE TABLE magic_links (
  email         TEXT NOT NULL,
  otp_hash      TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  PRIMARY KEY (email, otp_hash)
);

COMMIT;
