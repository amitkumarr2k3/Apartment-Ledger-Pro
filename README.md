# Apartment Ledger Pro

Self-hosted, Docker-based portal for apartment communities.
Postgres system of record, Fastify API, React/TanStack frontend, seeded demo data.

- **Two personas** — Resident (read-only dashboards) and Admin (dashboards + controls).
- **Admin controls** are separated from admin dashboards: analytics live under _Admin · Dashboards_, administrative CRUD/audit under _Admin · Controls_.
- **Auth is OTP-based** (no magic links). Only whitelisted emails receive a 6-digit code.
- **Vendors** are surfaced through insights only; the app does not offer a vendor CRUD screen. Vendor rows are imported via CSV or created on the fly when a transaction references a new vendor name.
- **CSV-first ingestion.** Transactions/residents can be uploaded with per-batch mapping rules to handle non-uniform month-over-month line items.

## Local setup — exact steps

### 1. Prerequisites

- Docker Desktop 4.30+ **or** `bun` 1.1+ (for the frontend-only preview).
- Ports free on the host: `8090` (web), `8035` (MailHog UI), `1035` (SMTP), `5442` (Postgres), `4010` (API). Container-internal ports (80/8025/1025/5432/4000) are unchanged, so nothing inside the compose network needs reconfiguring — override the host side in `docker-compose.yml` if these still collide.

### 2. Environment variables

```bash
cp .env.example .env
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection used by API + migrator | `postgres://apf:apf@db:5432/apartment_finance` |
| `JWT_SECRET` | Signs session tokens issued after OTP verification | dev value — **rotate for prod** |
| `SUPERADMIN_EMAIL` | Bootstrap admin whitelisted on first migration | `admin@example.com` |
| `SMTP_HOST` / `SMTP_PORT` | Where OTP emails go (MailHog in dev, container port) | `mailhog` / `1025` |
| `APP_URL` | Absolute URL used inside OTP emails | `http://localhost:8090` |

### 3. Boot the full stack (Docker)

```bash
docker compose up -d --build              # db, api, web, mailhog, migrate
open http://localhost:8090                # portal
open http://localhost:8035                # MailHog inbox for OTPs
```

If your logs show either `Cannot find module '/app/dist/server.js'` or
`host not found in upstream "api"`, Docker is still running an older built
image/config. Force a clean rebuild once:

```bash
docker compose down --remove-orphans
docker compose build --no-cache api migrate web
docker compose up -d
```

Expected fixed startup logs include:

```text
[backend] resolving api entrypoint: dist/src/server.js
[backend] starting dist/src/server.js
```

Compose runs the `migrate` service on startup, applying every
`backend/db/migrations/*.sql` in order and recording them in `_migrations`.
The **OTP migration** is `0004_otp_rename.sql` — it renames the legacy
`magic_links` table to `otp_codes` and clarifies that vendors are read-only.

Re-run migrations manually (idempotent; applied files are skipped):

```bash
docker compose run --rm migrate node dist/scripts/migrate.js
make psql          # then: \dt   (expect otp_codes, no magic_links)
```

Reset the database entirely (drops volumes, reruns every migration + seed):

```bash
make reset
```

### 4. Login (OTP flow) — feature-flagged

**The login page is disabled by default in this prototype.** Every visitor is
auto-signed in as an admin so residents / reviewers can click straight into
any dashboard.

**Toggle location:** [`src/lib/feature-flags.ts`](src/lib/feature-flags.ts)

```ts
// src/lib/feature-flags.ts
export const AUTH_ENABLED = false;   // ← flip to `true` to require login
export const GUEST_SESSION = { email: "guest@prototype.local", role: "admin", ... };
```

- `AUTH_ENABLED = false` → login route bypassed, `GUEST_SESSION` (admin) used
  everywhere. The backend auth code is untouched.
- `AUTH_ENABLED = true` → rebuild the web container (`docker compose up -d --build web`)
  and use the flow below.

When enabled:

1. Open `http://localhost:8090/login`.
2. Enter a whitelisted email (`admin@example.com`, `treasurer@example.com`, or `resident@example.com`).
3. Open MailHog at `http://localhost:8035` and copy the 6-digit OTP.
4. Paste it back → the app stores a JWT in `localStorage` and the route guards let you in.
5. Residents are blocked from `/admin/*` by the client `RouteGuard` **and** by the API role check.

### 5. Frontend-only preview (no backend, mock OTP)

```bash
bun install
bun dev
```

The prototype falls back to `src/lib/finance-mock.ts` and issues a mock OTP —
the login page shows the code on-screen so you can paste it without SMTP.

### 6. Health, readiness & smoke test

| Endpoint | Purpose |
| --- | --- |
| `GET http://localhost:4010/health` | API liveness — cheap, no DB. |
| `GET http://localhost:4010/ready`  | API readiness — DB reachable + `_migrations` populated. Returns 503 with `checks` JSON otherwise. |
| `GET http://localhost:8090/health` | Web container liveness (nginx-served, no upstream). |

#### Running the smoke test

```bash
# 1. Start (or rebuild) the stack
docker compose up -d --build

# 2. Run the smoke test
make smoke                                    # default settings
LOG_LINES=200 make smoke                      # more logs on failure
TIMEOUT=180 READY_TIMEOUT=300 make smoke      # slow machines / cold DB
API_URL=http://localhost:4010 \
  WEB_URL=http://localhost:8090 make smoke    # custom ports

# Direct invocation (identical):
./scripts/smoke-test.sh
```

The script needs only `curl` and `bash`. It parses `/ready` JSON with `jq`
when available, otherwise falls back to `python3`, then `python`, then a
regex-based grep parser — so it works on minimal CI images too.

#### Interpreting the output

Each check prints one of three prefixes:

| Prefix | Meaning |
| --- | --- |
| `PASS ✅` | Assertion held. |
| `...`    | Progress / polling attempt. |
| `FAIL ❌` | Hard failure — the script exits non-zero and dumps `docker compose ps` plus the last `LOG_LINES` (default 100) of `api`, `web`, `db`, and `migrate` logs. |

**`/ready` assertion** — polled with exponential backoff (1s → 2s → 4s → 8s,
capped at 15s) until `READY_TIMEOUT` seconds (default 180s) elapse. It
passes only when **all** of these are true:

- HTTP 200
- `status == "ready"` and `ok == true`
- `checks.db.ok == true` and `checks.db.latency_ms` present
- `checks.migrations.ok == true`
- `checks.migrations.applied >= 1`
- `checks.migrations.last.name` present

A typical pass line looks like:
`PASS API /ready ready after 2 attempt(s) / 3s (http=200 status=ready db.ok=true migrations=4)`

**Proxy-vs-direct assertion** — the script hits
`GET /api/dashboard/monthly-totals` twice: once through nginx
(`$WEB_URL/api/...`) and once directly on the API (`$API_URL/api/...`).
Interpret the two status codes together:

| Proxy | Direct | Meaning |
| --- | --- | --- |
| 200/400/401 | 200/400/401 (same) | ✅ Best case — nginx is routing to the API and both paths see the same auth state. |
| 200/400/401 | 200/400/401 (different) | ⚠️ Info-level only. Both non-5xx means the proxy reached the API; the codes can differ if the two paths carry different auth. |
| **502/503/504** | any | ❌ Hard fail — nginx could not reach the API container (upstream DNS, wrong port, or API crashed). Fix `web/nginx.conf` upstream or check the `api` container. |
| **000** | any | ❌ Hard fail — nothing responded on `$WEB_URL`; the web container is down. |

#### CI

The same script runs in `.github/workflows/compose-smoke.yml` on every PR
and push to `main`. When it fails, the workflow uploads `compose-logs/`
(per-service logs for `api`, `web`, `db`, `migrate`, `mailhog`, plus a
combined `all-services.log` and `docker compose ps`) as a build artifact
named `compose-logs-<run-id>-<attempt>`, retained for 14 days.


## Documentation

| File | Purpose |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Component/deployment architecture, container topology |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Postgres schema, sparse-data strategy, rollups |
| [`docs/AUTH.md`](docs/AUTH.md) | Whitelist + OTP flow, RBAC, session lifetime |
| [`docs/ADMIN-CONTROLS.md`](docs/ADMIN-CONTROLS.md) | Dashboard visibility toggles, Residents, Audit, CSV imports |
| [`docs/TDD.md`](docs/TDD.md) | Full technical design |
| [`docs/CSV-SPECS.md`](docs/CSV-SPECS.md) | Expected CSV columns for each import kind |
| [`docs/responsive-checklist.md`](docs/responsive-checklist.md) | Responsive QA checklist |
| [`docs/architecture.html`](docs/architecture.html) | Illustrated architecture (open in browser) |
| [`docs/requirements.html`](docs/requirements.html) | Full requirements matrix (open in browser) |

## Route map

### Resident dashboards
| URL | Requirement IDs |
| --- | --- |
| `/resident/overview` | RD-01 → RD-05 |
| `/resident/drilldown` | RD-10 → RD-15 |
| `/resident/cashflow` | RD-20 → RD-23 |
| `/resident/income` | RD-30 → RD-32 |
| `/resident/balance` | RD-40 → RD-44 |

### Admin · Dashboards
| URL | Requirement IDs |
| --- | --- |
| `/admin/actions` | AD-40 → AD-43 |
| `/admin/alerts` | AD-01 → AD-05 |
| `/admin/vendors` | AD-10 → AD-14 (insight-only) |
| `/admin/collections` | AD-20 → AD-24 |
| `/admin/income` | AD-30 → AD-33 |

### Admin · Controls
| URL | Requirement IDs |
| --- | --- |
| `/admin/transactions` | AC-01 → AC-05 · Transactions CRUD |
| `/admin/residents` | AC-10 → AC-13 · Whitelist CRUD |
| `/admin/settings` | AC-30 → AC-32 · Dashboard visibility |
| `/admin/audit` | AC-40 → AC-41 · Audit trail |
| `/admin/imports` | AC-50 → AC-52 · CSV upload |

## API surface

Full endpoint reference with request/response shapes and the UI↔API↔DB coverage matrix:
[`docs/API-REFERENCE.md`](docs/API-REFERENCE.md).

Quick list:

```
POST  /api/auth/request-otp        {email}          → 202 (silent if not whitelisted)
POST  /api/auth/verify-otp         {email, otp}     → 200 {token, user}
GET   /api/me
GET   /api/dashboard/monthly-totals ?period=
GET   /api/dashboard/balance-strip  ?period=
GET   /api/expenses/tree | /category-totals | /anomalies
GET   /api/income/tree   | /category-totals
GET   /api/vendors/ranking                          (read-only insight)
GET   /api/collections
GET   /api/admin/settings/dashboards
PATCH /api/admin/settings/dashboards
GET/POST/PATCH/DELETE /api/admin/transactions
GET/POST/PATCH/DELETE /api/admin/residents
GET   /api/admin/audit
POST  /api/admin/imports/:kind  (multipart)
POST  /api/admin/imports/:batchId/preview
POST  /api/admin/imports/:batchId/commit
```

There is no `/api/admin/vendors` — vendor rows are seeded/imported and never edited from the UI.

## Database — schema & seed scripts

All DB objects live under `backend/db/`. Migrations run in filename order and
are recorded in the `_migrations` table so re-runs are idempotent.

| Script | What it creates |
| --- | --- |
| `backend/db/migrations/0001_init.sql` | Core schema: `communities`, `flats`, `allowed_emails`, `sessions`, `otp_codes` (was `magic_links`), `heads`, `categories`, `vendors`, `line_items`, `transactions`, `balances`, `dashboard_settings`, `audit_log`, `import_batches`, `import_staging`, `import_rules`. Enums, FKs, `updated_at` triggers. |
| `backend/db/migrations/0002_indexes.sql` | Query indexes on `transactions(period_month, head_id)`, `(community_id, txn_date)`, vendor/category lookups, audit filters. |
| `backend/db/migrations/0003_mviews.sql` | Materialised views `mv_monthly_totals`, `mv_category_monthly`, `mv_vendor_ranking` (refreshed after seed and after each commit). |
| `backend/db/migrations/0004_otp_rename.sql` | Renames legacy `magic_links` → `otp_codes`, adds `attempts`/`consumed_at` columns. |
| `backend/scripts/migrate.ts` | Migration runner. Reads every `db/migrations/*.sql` in order, skips already-applied entries. Invoked by the `migrate` compose service on boot. |
| `backend/scripts/seed.ts` | Loads the demo community (`Green Meadows`), 24 flats, 3 whitelisted users, expense/income category tree, ~12 months of transactions with intentional sparse gaps, opening/closing balances, and enables every dashboard. Mirrors `src/lib/finance-mock.ts` so the seeded data matches the frontend prototype 1:1. |

Run manually:

```bash
docker compose run --rm migrate node dist/scripts/migrate.js   # apply pending migrations
docker compose run --rm migrate node dist/scripts/seed.js      # seed demo data (skips if community exists)
make reset                                                     # wipe volume + re-migrate + re-seed
```

## Implementation completeness

Every UI screen has a live Fastify endpoint and a Postgres table/view backing it —
see the coverage matrix in [`docs/API-REFERENCE.md`](docs/API-REFERENCE.md#coverage-matrix--ui--api--db).

| Layer | Status |
| --- | --- |
| Postgres schema (4 migrations, 17 tables, 3 mviews) | ✅ |
| Seed script matching frontend mock | ✅ |
| Fastify API (12 route modules, 27 endpoints) | ✅ |
| JWT auth + RBAC middleware + audit interceptor | ✅ |
| CSV import pipeline (upload/preview/commit + rules) | ✅ |
| React frontend (19 routes, unified shell, ⌘K, deep-links) | ✅ |
| Frontend RouteGuard + role gating | ✅ |
| Auth feature flag (`src/lib/feature-flags.ts → AUTH_ENABLED`) | ✅ off in prototype |
| Docker compose (db, api, web, mailhog, migrate) | ✅ |
| Vitest tests: RBAC, importer, rollups | ✅ |
| Playwright responsive regression script | ✅ |

## Test

```bash
cd backend && npm install && npx tsc && npx vitest run --coverage
bun scripts/responsive-check.mjs
```

## Make targets

`make up | down | logs | psql | seed | reset | test`

