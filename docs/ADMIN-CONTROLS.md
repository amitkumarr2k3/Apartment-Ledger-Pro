# Admin Controls

The Admin persona sees two navigation groups. This document covers the
**Admin · Controls** group only — the screens that mutate state.

## 1. Transactions (`/admin/transactions`)

- Filter by month, head (income/expense), text search.
- Create / edit / delete individual rows.
- Every mutation writes to `audit_log` in the same transaction.
- CSV import is the bulk path; this screen is for corrections and one-offs.

## 2. Residents & Whitelist (`/admin/residents`)

- Add an email → row is inserted into `allowed_emails` with the chosen role
  and flat. On next login the user receives an OTP.
- Toggle role between `resident` and `admin`.
- Revoke → sets `revoked_at`; further OTP requests silently no-op.
- Reactivate → clears `revoked_at`.
- Delete (superadmin only) — removes the row entirely.

## 3. Dashboard Controls (`/admin/settings`)

Controls what residents see. Two levels of granularity:

- **Dashboard toggle** — enable/disable a whole screen for residents
  (e.g. hide `resident.balance` until the finance team is happy with the numbers).
- **Widget toggle** — keep the dashboard visible but hide one card
  (e.g. `runway` on Cashflow Health during a lean period).

Persisted in `dashboard_settings`. Enforced in both frontend routing and
backend read endpoints, so a resident cannot reach hidden data by URL.

## 4. Audit Trail (`/admin/audit`)

Read-only immutable log. Filter by actor, action, entity, or time range.
Shows `before`/`after` JSON for each mutation so a change is fully
attributable and reversible.

## 5. CSV Imports (`/admin/imports`)

Three-step wizard: **Upload → Map → Preview → Commit**.

1. Upload — file is streamed into `import_batches` / `import_staging`.
2. Map — apply `import_rules` (regex/equality) to normalise vendor
   descriptions, category names, and directions. Rules can be saved for
   reuse across months.
3. Preview — shows the (mapped) rows that will be inserted and any errors.
4. Commit — inserts into `transactions` inside a single transaction. Any
   failure rolls back; partial-commit is a chosen mode where valid rows are
   committed and invalid ones remain in staging for re-mapping.

CSV kinds accepted:

| Kind | Purpose |
| --- | --- |
| `transactions` | Expense + collection + income rows (this is the primary and largest feed). |
| `residents` | Refreshes the whitelist (does not delete existing entries). |
| `vendors` | Optional; auto-created on ingest if omitted. |

There is **no vendor CRUD screen** — the operational model is that vendors
appear in the data. If a vendor name needs cleanup, an `import_rule` handles
it during the map step (e.g. `"BESCOM PVT LTD"` → `"Bescom"`).

## What Admin CANNOT do

- Read or export raw OTP codes (only their SHA-256 hashes are stored).
- Edit audit log entries.
- Change their own role from `admin` to `superadmin` (requires an existing
  superadmin).
- Manage vendors via a form (curation happens through import rules).
