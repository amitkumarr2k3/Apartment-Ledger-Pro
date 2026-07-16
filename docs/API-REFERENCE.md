# API Reference

Base URL: `http://localhost:4010` (dev, published host port) · Prefix: `/api`. Inside the compose network the API still listens on container port `4000`; the web container proxies `/api/*` to `http://api:4000`.

All endpoints (except `/health` and `/api/auth/*`) require
`Authorization: Bearer <jwt>` obtained from `POST /api/auth/verify-otp`.
Mutating admin endpoints additionally require `role in (admin, superadmin)`.

Money is transported in **paise** (integer). Frontend divides by 100 for `₹`.

---

## Health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness probe → `{ ok: true }` |

## Auth (`/api/auth`)

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/request-otp` | none | `{ email }` | `202 { sent: true }` — emails a 6-digit OTP if email is in `allowed_emails` and not revoked. Silent no-op otherwise (no user enumeration). |
| POST | `/verify-otp` | none | `{ email, otp }` | `200 { token, user: { id, email, role, community_id, name } }` |
| POST | `/request-magic-link` | none | — | **Deprecated** alias of `/request-otp`. Kept for one release. |
| POST | `/verify` | none | — | **Deprecated** alias of `/verify-otp`. |

OTP: 6 digits, TTL 10 min, single-use, SHA-256 hashed at rest, max 5 verify
attempts per code. JWT TTL 12h. See [`AUTH.md`](./AUTH.md).

## Session (`/api`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/me` | bearer | Returns current user + role + community + enabled dashboards. |

## Resident Dashboards

### `/api/dashboard`

| Method | Path | Query | Purpose | Powers UI |
| --- | --- | --- | --- | --- |
| GET | `/monthly-totals` | `period=range-3m\|6m\|12m\|fy` | Per-month income, expense, net (paise). | Resident/Admin Overview, Cashflow |
| GET | `/balance-strip` | `period` | Opening / inflow / outflow / closing per month + runway months. | Resident/Admin Balance |

### `/api/expenses`

| Method | Path | Query | Purpose | Powers UI |
| --- | --- | --- | --- | --- |
| GET | `/tree` | — | Head → Category → Vendor → Line-Item hierarchy. | Drilldown navigator |
| GET | `/category-totals` | `period`, `category?` | Totals per category (and per vendor when `category` set). | Expense drilldown, pie chart |
| GET | `/anomalies` | `period`, `sigma=2` | Line-items with month values > μ + σ·k. | Admin Alerts, Admin Actions |

### `/api/income`

| Method | Path | Query | Purpose |
| --- | --- | --- | --- |
| GET | `/tree` | — | Income category tree. |
| GET | `/category-totals` | `period`, `category?` | Income totals. |

### `/api/vendors`

| Method | Path | Query | Purpose |
| --- | --- | --- | --- |
| GET | `/ranking` | `period`, `limit=20` | Vendor spend ranking with MoM delta. Read-only — no CRUD. |

### `/api/collections`

| Method | Path | Query | Purpose |
| --- | --- | --- | --- |
| GET | `/` | `period` | Collection efficiency, dues aging, per-flat status. |

## Admin · Controls (`/api/admin`)

All routes require `role in (admin, superadmin)`. Every mutation writes an
`audit_log` row in the same DB transaction (see [`ADMIN-CONTROLS.md`](./ADMIN-CONTROLS.md)).

### Transactions — `/api/admin/transactions`

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/` | — · query: `month, head, category, vendor, q, page, pageSize` | Filtered list + totals. |
| POST | `/` | `{ date, month, head, category_id, vendor_id?, line_item_id?, amount_paise, direction, notes? }` | Creates txn + audit entry. |
| PATCH | `/:id` | partial of above | Updates + captures before/after. |
| DELETE | `/:id` | — | Soft-forbidden if referenced by import batch; else hard delete. |

### Residents & Whitelist — `/api/admin/residents`

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/` | — · query: `q, role, revoked` | Whitelist entries with last login. |
| POST | `/` | `{ email, role, flat?, name? }` | Adds to `allowed_emails`. |
| PATCH | `/:email` | `{ role?, flat?, name?, revoked? }` | Toggle role, revoke, reactivate. |
| DELETE | `/:email` | — | Superadmin only. |

### Dashboard Controls — `/api/admin/settings`

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/dashboards` | — | Array of `{ dashboard_key, enabled, hidden_widgets[] }`. |
| PATCH | `/dashboards` | `{ dashboard_key, enabled?, hidden_widgets? }` | Enforced in both `/api/dashboard/*` reads and frontend routing. |

### Audit Trail — `/api/admin/audit`

| Method | Path | Query | Notes |
| --- | --- | --- | --- |
| GET | `/` | `actor, action, entity, from, to, page` | Read-only immutable log. |

### CSV Imports — `/api/admin/imports`

Wizard: **Upload → Preview → Commit**. `kind ∈ { transactions, residents, vendors }`.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/:kind` | `multipart/form-data` file | Streams into `import_batches` + `import_staging`. Returns `{ batchId, rows, errors[] }`. |
| POST | `/:batchId/preview` | `{ rules?: ImportRule[] }` | Applies mapping rules, returns mapped rows + validation errors. |
| POST | `/:batchId/commit` | `{ rules?, mode: "strict"\|"partial" }` | Atomic insert; strict rolls back on any error, partial keeps invalid rows in staging. |

---

## Coverage Matrix — UI ↔ API ↔ DB

| UI route | API endpoints used | DB tables / views |
| --- | --- | --- |
| `/login` | `auth/request-otp`, `auth/verify-otp` | `allowed_emails`, `otp_codes`, `sessions` |
| `/resident/overview` | `dashboard/monthly-totals`, `dashboard/balance-strip` | `mv_monthly_totals`, `balances` |
| `/resident/drilldown` | `expenses/tree`, `expenses/category-totals` | `mv_category_monthly`, `line_items`, `vendors` |
| `/resident/cashflow` | `dashboard/monthly-totals` | `mv_monthly_totals` |
| `/resident/income` | `income/tree`, `income/category-totals` | `mv_category_monthly` |
| `/resident/balance` | `dashboard/balance-strip` | `balances` |
| `/admin/income` | `income/*` | same as resident |
| `/admin/collections` | `collections/` | `flats`, `transactions` |
| `/admin/vendors` | `vendors/ranking` | `mv_vendor_ranking` |
| `/admin/alerts` | `expenses/anomalies` | `transactions` |
| `/admin/actions` | `expenses/anomalies` + `admin/audit` | `transactions`, `audit_log` |
| `/admin/transactions` | `admin/transactions/*` | `transactions`, `audit_log` |
| `/admin/residents` | `admin/residents/*` | `allowed_emails`, `audit_log` |
| `/admin/settings` | `admin/settings/dashboards` | `dashboard_settings` |
| `/admin/audit` | `admin/audit/` | `audit_log` |
| `/admin/imports` | `admin/imports/*` | `import_batches`, `import_staging`, `import_rules`, `transactions` |

Every UI screen has a live backend endpoint. The frontend gracefully falls
back to `src/lib/finance-mock.ts` when the API is unreachable (design mode).
