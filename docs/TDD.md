# Technical Design Document
## Apartment Ledger Pro — Self-Hosted, Docker-Based

**Version:** 1.0 · **Owner:** Apartment Ledger Pro team · **Status:** Approved for build

---

## 1. Overview

A self-hosted web application for apartment communities to manage income, expenses, vendors, collections, and resident-facing dashboards. Distributed as a `docker compose` stack — no external SaaS, no per-user fees. Ships with seeded demo data so the community can evaluate before importing real records.

### 1.1 Personas & scope

| Persona | Access |
|---|---|
| **Superadmin** | Everything Admin can do plus managing other admins. Seeded from `SUPERADMIN_EMAIL`. |
| **Admin / Treasurer** | Full CRUD on transactions, residents, vendors; dashboard visibility settings; audit log; CSV import. |
| **Resident** | Only dashboards the admin has enabled; community-level view; sees their own flat's dues. |

### 1.2 Non-goals (v1)

- Online payment collection (Razorpay/UPI intent) — hook points exist; flow does not.
- Native mobile app — PWA-ready responsive web only.
- Multi-community onboarding UI — schema is multi-tenant; UI ships single-community.
- Accounting-software live sync — CSV import + scheduled cron is the integration seam.

---

## 2. Architecture

```text
┌────────────┐   HTTPS   ┌───────────────┐   proxy_pass /api/*  ┌─────────────┐
│  Browser   │──────────▶│  web (Nginx)  │─────────────────────▶│  api        │
│            │           │  built Vite   │                      │  Fastify 4  │
└────────────┘           └───────────────┘                      └──────┬──────┘
                                                                       │
                                                              pg (5432)│
                                                                       ▼
                                                              ┌────────────────┐
                                                              │  db (Postgres) │
                                                              └────────────────┘
```

Containers:

| Service | Image | Purpose |
|---|---|---|
| `db` | `postgres:16-alpine` | System of record |
| `migrate` | custom | Applies SQL migrations + optional seed on boot |
| `api` | custom (Node 20 + Fastify) | REST API on `:4000` |
| `web` | custom (Nginx + built Vite) | Serves static UI, reverse-proxies `/api/*` |
| `mailhog` | `mailhog/mailhog` | Local SMTP for magic-link OTPs |

---

## 3. Deployment

### 3.1 Local

```bash
cp .env.example .env
docker compose up -d --build
open http://localhost:8090
# MailHog inbox for OTPs: http://localhost:8035
```

Superadmin email defaults to `admin@example.com`. Log in → check MailHog → paste OTP.

### 3.2 Production hardening (checklist)

- Terminate TLS at a reverse proxy (Caddy/Traefik). Set `Secure`, `HttpOnly`, `SameSite=Lax` cookies.
- Replace `JWT_SECRET` with a 64-char random value (`openssl rand -hex 32`).
- Point SMTP to a real transactional provider (SES, Postmark).
- Nightly `pg_dump` cron → offsite bucket. Retention: 30 daily + 12 monthly.
- Restrict Postgres port to the compose network only.
- Turn on structured JSON logs (`LOG_LEVEL=info`).

### 3.3 Cost profile

Sized for a single 100-flat community: 1 GB RAM, 20 GB disk. Runs comfortably on a ₹500/mo VPS. No CapEx.

---

## 4. Data model

### 4.1 ER (abridged)

```text
communities ─┬─ flats
             ├─ allowed_emails ── users ── user_roles
             ├─ heads ── categories ── line_items
             │                       └─ vendors
             ├─ transactions (fact) ──► heads, categories, vendors, line_items, flats
             ├─ balances (per month)
             ├─ collections_dues (per flat, per month)
             ├─ dashboard_settings
             ├─ import_batches ── import_staging
             │                └─ import_rules
             └─ audit_log
```

### 4.2 Table dictionary — highlights

- **`transactions`** — long-format fact table; one row per posted amount. Money as `BIGINT amount_paise`. `UNIQUE (source, source_ref)` makes CSV imports idempotent.
- **`line_items`** — created on-the-fly during import. **Not** assumed to exist every month (design point 8).
- **`dashboard_settings`** — `(community_id, dashboard_key)` PK. Controls what residents see.
- **`allowed_emails`** — the email whitelist. Login is impossible for emails not in this table.
- **`audit_log`** — every mutation writes a row inside the same transaction.

### 4.3 Indexing

`(community_id, period_month)` on `transactions` plus (category, vendor, head, flat) narrow indexes; `audit_log(at DESC)` for the audit UI's default sort.

### 4.4 Materialised views

- `mv_monthly_totals` — month spine × community, left-joined to transactions so missing months render as zeros.
- `mv_category_monthly` — per-category monthly totals.
- `mv_vendor_ranking` — vendor expense totals with `months_active`.

Refreshed after every transactions mutation (debounced) and after every CSV commit.

---

## 5. Handling non-uniform line items (design point 8)

Real data has categories that appear in only some months (e.g. "STP salt purchase" every ~4 months). The design:

1. **Long-format storage** — no wide "months as columns" tables.
2. **Optional `line_items`** — `line_item_id` on `transactions` is nullable. New labels are inserted on first sighting during import; near-duplicates are collapsed by `import_rules`.
3. **Month spine on read** — every trend query left-joins a `generate_series` spine so missing months become zeros in the chart, not gaps in the SQL result.
4. **Anomaly detection** — averages over *available* prior periods (`WHERE amount > 0`), skipping missing months rather than dragging the mean toward zero.

---

## 6. API reference

Base: `/api`. JSON only. Auth: `Authorization: Bearer <jwt>` except `/auth/*` and `/health`.

### 6.1 Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/request-magic-link` | `{email}` | Always returns `{ok:true}` (does not reveal whitelist state). |
| POST | `/auth/verify` | `{email, otp}` | Returns `{token, user}`. Rejects non-whitelisted emails with 403. |
| GET | `/me` | — | Current user + enabled dashboards. |

### 6.2 Resident reads

| Method | Path |
|---|---|
| GET | `/dashboard/monthly-totals?from&to` |
| GET | `/dashboard/balance-strip?from&to` |
| GET | `/expenses/tree` |
| GET | `/expenses/category-totals` |
| GET | `/expenses/anomalies` |
| GET | `/income/tree` |
| GET | `/income/category-totals` |
| GET | `/vendors/ranking` |
| GET | `/collections?period=YYYY-MM-01` |

### 6.3 Admin CRUD (all require `admin` or `superadmin` role)

| Resource | Endpoints |
|---|---|
| Transactions | `GET/POST /admin/transactions`, `PATCH/DELETE /admin/transactions/:id` |
| Residents (whitelist) | `GET/POST /admin/residents`, `PATCH/DELETE /admin/residents/:email` |
| Vendors | `GET/POST /admin/vendors`, `PATCH/DELETE /admin/vendors/:id` |
| Settings | `GET /admin/settings/dashboards`, `PATCH /admin/settings/dashboards` |
| Audit | `GET /admin/audit?entity&actor&from&to&page&pageSize` |
| Imports | `POST /admin/imports/:kind`, `POST /admin/imports/:batchId/preview`, `POST /admin/imports/:batchId/commit` |

All mutating endpoints wrap the mutation and `audit_log` insert in a single Postgres transaction. Rollups are refreshed after transaction mutations and after CSV commits.

### 6.4 Error contract

`{ "error": "code", "message": "…" }` with standard HTTP codes: 400 validation, 401 no/invalid token, 403 role mismatch, 404 not found, 409 conflict, 500 server.

---

## 7. AuthN / AuthZ

### 7.1 Magic-link (default)

1. Resident/admin enters email.
2. API checks `allowed_emails`. If not there, returns 200 silently (no user enumeration).
3. Server generates 6-digit OTP, stores SHA-256 hash + 15-min TTL, emails plaintext via SMTP.
4. Client submits `{email, otp}` → server verifies, mints JWT (12h), sets audit row.

### 7.2 JWT contents

```json
{ "sub": "<user id>", "email": "…", "roles": ["resident"], "cid": "<community id>" }
```

Signed HS256 with `JWT_SECRET`. Verified by Fastify `preHandler`. Role gates live on route groups (`app.requireRole(["admin","superadmin"])`).

### 7.3 RBAC matrix

| Route group | Resident | Admin | Superadmin |
|---|---|---|---|
| `/dashboard/*`, `/expenses/*`, `/income/*`, `/vendors/*`, `/collections` | ✓ (filtered by `dashboard_settings`) | ✓ | ✓ |
| `/admin/transactions`, `/admin/vendors`, `/admin/imports`, `/admin/audit`, `/admin/settings/dashboards` | ✗ | ✓ | ✓ |
| `/admin/residents` role=superadmin edits | ✗ | ✓ (self-role stays) | ✓ |

---

## 8. Admin control plane

- **Transactions screen** — month picker, table with filters (head/category/vendor/flat/direction), inline create/edit drawer, delete confirm, CSV re-export.
- **Residents screen** — CRUD over `allowed_emails`. Adding an email whitelists it. Revoking sets `revoked_at`; users can no longer log in but historical audit rows are retained.
- **Vendors screen** — CRUD over `vendors`; renaming propagates via FK (no cascade needed).
- **Settings → Dashboards** — 5-row toggle matrix + per-widget hide list. Persisted to `dashboard_settings`; resident SPA re-fetches on login.
- **Audit** — searchable by entity/actor/date range with before/after JSON diff viewer.

Every write path calls `audit(...)` inside the same transaction — an audit row is never missed and can never disagree with the state change.

---

## 9. Import pipeline

Three CSV kinds (design point 7): **transactions**, **residents**, **vendors**. Any other formats route into transactions after transformation.

### 9.1 Flow

```text
upload → import_batches row + import_staging rows
       → preview (returns first 50 mapped rows + validation errors)
       → commit (per-row insert inside single tx; per-row error captured on failure)
       → refresh materialised views (transactions only)
```

### 9.2 Transformation rules

`import_rules(match JSONB, set_fields JSONB, priority)` runs per staged row before commit. Example rule:

```json
{"match":{"description":"BESCOM.*"},"set_fields":{"category":"Utilities","vendor":"Bescom","direction":"D"}}
```

Rules canonicalise near-duplicates ("STP Salt Purchase" → "STP salt purchase") and infer missing columns from patterns in the source data.

### 9.3 Expected CSV columns

- **transactions.csv** — `date, head, category, vendor?, line_item?, amount, direction, flat_code?, source_ref?`
- **residents.csv** — `email, name?, flat_code?`
- **vendors.csv** — `name, kind?` (`company` | `individual`)

Sample fixtures in `docs/samples/`.

### 9.4 Idempotency

`(source, source_ref)` is unique. Re-uploading the same file with the same `source_ref` values inserts nothing new.

---

## 10. Frontend architecture

- **Framework**: React 19 + TanStack Start (Vite 7), TanStack Query, shadcn/ui, Recharts, Tailwind v4.
- **Route tree**:
  - `/auth/*` — public magic-link screens.
  - `/_resident/*` — role-gated resident dashboards (existing 5 screens).
  - `/_admin/*` — role-gated admin sections (existing 5 dashboards + transactions / residents / vendors / settings / audit / imports).
- **Data**: every screen reads via TanStack Query hooks in `src/lib/api.ts`. Dev/preview fallback to bundled mock so the UI runs standalone.
- **Global controls**: `PortalShell` owns period selector, chart/table toggle, print/CSV, `⌘K` palette, persona switch (admin-only visible).

---

## 11. Testing & CI

Coverage targets: **API ≥ 90% lines**, **shared math ≥ 80%**, **frontend screens covered by MSW-backed render tests + Playwright smoke**.

Suites:
- `backend/test/*.test.ts` — unit (rollup math, importer parsing, RBAC contract).
- Integration tests use a real Postgres via GitHub Actions `services`.
- Playwright smoke: login → resident overview → admin CRUD → CSV import → logout.

CI (`.github/workflows/ci.yml`) runs migrations + seed against a service Postgres, executes vitest with coverage, then builds the frontend.

---

## 12. Observability

- Fastify pino logs with `req_id` correlation.
- `/health` liveness endpoint (used by compose healthcheck).
- Structured audit trail doubles as an application event log.
- Optional: enable `pg_stat_statements` and mount Grafana as an add-on service.

---

## 13. Security

- **Whitelist-only login** — `allowed_emails` is the sole path to a session.
- **No password by default** — magic-link OTP, hashed with SHA-256, 15-min TTL, single-use.
- **Input validation** — every route body/query parsed with Zod; unknown fields dropped.
- **SQL** — parametrised only; no string concatenation.
- **JWT** — 12h TTL, HS256; rotate `JWT_SECRET` invalidates all sessions.
- **CORS** — same-origin in prod (Nginx proxies `/api`); dev allows all.
- **Rate-limit** — Fastify `@fastify/rate-limit` on `/auth/*` (20 req/min per IP).
- **Money** — stored as `BIGINT paise` to avoid floating-point drift; formatted at the edge.

---

## 14. Runbook

| Task | Command |
|---|---|
| Boot everything | `make up` |
| Tail API logs | `make logs` |
| Open psql | `make psql` |
| Reset (drop volume) | `make reset` |
| Manual seed | `make seed` |
| Nightly backup | `docker compose exec db pg_dump -U apf apartment_finance | gzip > /backups/$(date +%F).sql.gz` |
| Restore | `gunzip -c backup.sql.gz | docker compose exec -T db psql -U apf apartment_finance` |
| Refresh rollups | `docker compose exec db psql -U apf -d apartment_finance -c "REFRESH MATERIALIZED VIEW mv_monthly_totals;"` |
| Add superadmin | `INSERT INTO allowed_emails (email, community_id, role, invited_by) VALUES (…, …, 'superadmin', 'system');` |
| Revoke access | `UPDATE allowed_emails SET revoked_at=now() WHERE email=…;` |

---

## 15. Roadmap

- Razorpay collection link generation per unpaid `collections_dues` row.
- WhatsApp/email reminders (BullMQ + Redis service).
- Tally / Zoho Books outbound sync (nightly cron writing to their APIs).
- Per-flat resident portal (dues, receipts, complaints).
- Fine-grained roles (auditor read-only, treasurer no-delete).
