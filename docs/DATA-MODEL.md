# Data Model

Postgres 16. Full DDL under `backend/db/migrations/`.

## Core dimensions

- `communities` — a single society is one row; the schema is multi-tenant-ready.
- `flats(community_id, code, owner_email)` — physical units.
- `allowed_emails(email PK, community_id, role, flat_id, revoked_at)` — the
  whitelist that gates OTP login.
- `users(id, email, community_id, ...)` — created on first successful OTP verify.
- `user_roles(user_id, role)` — separate from `users` for safe RBAC checks.
- `heads(id, community_id, kind income|expense, name)`.
- `categories(id, head_id, name)`.
- `vendors(id, community_id, name, kind)` — populated from CSV and
  transaction ingest; **no admin CRUD endpoint** (see [`ARCHITECTURE.md`](./ARCHITECTURE.md#vendor-handling-no-crud-screen)).
- `line_items(id, category_id, vendor_id, name, first_seen_month, last_seen_month)` —
  created on the fly per unique `(category, vendor, name)` triple.

## Facts

- `transactions(id, community_id, txn_date, period_month, head_id,
   category_id, vendor_id, line_item_id, amount_paise, direction C|D, source, source_ref, ...)`
  — the single source of truth. `UNIQUE (source, source_ref)` gives idempotent CSV re-imports.
- `balances(community_id, month, opening_paise, closing_paise)`.
- `collections_dues(flat_id, period_month, dues_paise, paid_paise, status)`.

## Auth / audit

- `otp_codes(email, otp_hash, expires_at, consumed_at)` — replaces the older
  `magic_links` table (renamed in migration `0004_otp_rename.sql`); only the
  hash is stored.
- `audit_log(id, community_id, actor_user_id, actor_email, entity, entity_id,
   action, before jsonb, after jsonb, at, ip, user_agent)`.

## Admin control plane

- `dashboard_settings(community_id, dashboard_key, enabled, hidden_widgets text[])`
  — one row per dashboard key (e.g. `resident.balance`). Widget-level hides
  live in the array so a dashboard can stay enabled with one component hidden.

## CSV imports

- `import_batches(id, community_id, filename, kind, uploaded_by, status,
   row_count, error, created_at)`.
- `import_staging(batch_id, row_no, raw_json, mapped_json, error)` — every
  raw row is preserved so a failed commit can be re-mapped and retried.
- `import_rules(id, community_id, kind, match jsonb, set_fields jsonb, priority)`
  — regex/equality rules that transform staged rows before commit. This is
  how non-canonical vendor descriptions get normalised to canonical
  `(category, vendor, line_item)` triples.

## Sparse data

Real-world data is not uniform: line items appear and disappear from month
to month, and vendors can be seasonal. The schema handles this without
placeholder rows:

- No pre-created empty transactions per month.
- `line_items` carries `first_seen_month`/`last_seen_month` so the UI can
  show accurate presence bands.
- Every time-series read left-joins against a generated month spine:

  ```sql
  SELECT m.month, COALESCE(t.amount_paise, 0) AS amount
  FROM generate_series($from::date, $to::date, interval '1 month') AS m(month)
  LEFT JOIN mv_monthly_totals t
    ON t.community_id = $cid AND t.month = m.month AND t.category_id = $c;
  ```

  So even if a category had zero activity in a month, the response includes
  that month with `0` — charts render continuously and comparisons stay
  aligned.

## Rollups

`mv_monthly_totals` and `mv_category_monthly` are refreshed on:
- successful CSV commit
- any manual transaction create/update/delete (in the same transaction)
- a nightly cron for safety

Read endpoints read only from the MVs; direct scans of `transactions` are
reserved for the admin Transactions CRUD screen and audit exports.
