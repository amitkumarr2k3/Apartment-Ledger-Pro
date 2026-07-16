# Architecture

## Container topology (docker-compose)

```
                     ┌──────────────────────┐
   browser ───────▶ │  web (nginx + Vite)   │
                     │  serves React SPA    │
                     └──────────┬───────────┘
                                │  /api/* proxied
                                ▼
                     ┌──────────────────────┐
                     │  api  (Fastify/Node) │
                     │  RBAC · CSV · Audit  │
                     └──────────┬───────────┘
                                │
                     ┌──────────▼───────────┐         ┌────────────────┐
                     │  db  (Postgres 16)   │         │  mailhog       │
                     │  + materialised views│         │  captures OTP  │
                     └──────────────────────┘         └────────────────┘
```

All four services run under a single `docker compose up`. Data persists in a
named `pgdata` volume. In production, replace `mailhog` with a real SMTP relay
and put nginx behind a TLS terminator (Caddy / Traefik / a managed LB).

## Frontend

- **TanStack Start / TanStack Router** with file-based routes under `src/routes/`.
- Shared shell `src/components/portal-shell.tsx` renders sidebar, header, tabs,
  period picker, chart/table toggle, CSV/Print, ⌘K palette.
- Client data layer: `src/lib/api.ts` calls the backend and falls back to
  `src/lib/finance-mock.ts` when the API is unreachable (design mode).

## Backend

- Fastify 4, one route module per resource under `backend/src/routes/`.
- Middleware chain: `auth` (JWT verify) → `requireRole([...])`.
- Every mutating handler wraps its work in `withTx` and calls `audit()`
  atomically so the audit log matches the data change 1:1.

## Authentication

Separate document: [`AUTH.md`](./AUTH.md). Summary: OTP over email, whitelisted
addresses only, 12-hour JWT.

## Persona split

The nav is composed from three groups in `src/lib/finance-mock.ts → navSections`:

1. **Resident** — five read-only dashboards.
2. **Admin · Dashboards** — the same analytics, at community scope.
3. **Admin · Controls** — Transactions CRUD, Residents whitelist, dashboard
   visibility settings, audit trail, CSV imports.

The Admin persona sees both admin groups; the header renders them on the
tab strip with a labelled divider (`Dashboards | Controls`) and the sidebar
shows them as two labelled sections.

## Vendor handling (no CRUD screen)

Vendor rows live in `vendors`. They are populated by (a) the seed script,
(b) CSV imports, or (c) on-the-fly during transaction ingest when a
transaction references an unknown vendor name. The UI surfaces vendors via
Vendor Insights (`/admin/vendors`) and expense drill-downs only — there is no
admin form to add/edit/delete vendors, matching the operational reality that
vendors are learned from data, not manually curated.

## Rollups and sparse data

Materialised views (`mv_monthly_totals`, `mv_category_monthly`) precompute
per-month/head/category totals. All time-series queries left-join a
generated month spine so months with no line items still return a row with
`0` — see [`DATA-MODEL.md`](./DATA-MODEL.md#sparse-data).
