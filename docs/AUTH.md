# Authentication & Authorisation

## Model

- **Whitelist-first.** No self sign-up. An admin adds an email to
  `allowed_emails` (via `/admin/residents` or CSV import) with a role
  (`resident` / `admin` / `superadmin`) and optionally a flat.
- **OTP over email.** There is _no_ clickable magic link. On login the user
  types their email; if it exists in `allowed_emails` with `revoked_at IS NULL`,
  the API emails a 6-digit OTP valid for 15 minutes.
- **Silent no-op for unknown emails.** Non-whitelisted addresses receive no
  code and the API still returns `200 { ok: true }` — this prevents
  enumeration of registered residents.

## Flow

```
   Browser                  API (Fastify)                       DB
      │  POST /api/auth/request-otp {email}          │           │
      │───────────────────────────────────────────▶  │           │
      │                                              │ SELECT    │
      │                                              │  allowed_ │
      │                                              │  emails   │
      │                                              │─────────▶ │
      │                                              │ ◀─────────│
      │                                              │ INSERT    │
      │                                              │  otp_codes│
      │                                              │─────────▶ │
      │                                              │ send mail │
      │  200 { ok: true }                            │           │
      │◀─────────────────────────────────────────────│           │
      │                                              │           │
      │  POST /api/auth/verify-otp {email, otp}      │           │
      │───────────────────────────────────────────▶  │           │
      │                                              │ verify +  │
      │                                              │ mark      │
      │                                              │ consumed  │
      │                                              │ upsert    │
      │                                              │ users     │
      │  200 { token, user }                         │           │
      │◀─────────────────────────────────────────────│           │
```

- **OTP storage:** `otp_codes(email, otp_hash, expires_at, consumed_at)`.
  Only the SHA-256 hash of the OTP is persisted.
- **Session:** JWT signed with `JWT_SECRET`, `exp = 12h`, claims
  `{ sub, email, roles[], cid }`.
- **Persistence on browser:** `localStorage["apf.token"]`. Rotate by logging
  in again; there is no refresh token.

## RBAC

Roles are stored per-user in `user_roles`. The Fastify decorator
`requireRole([...])` gates each admin route:

```ts
app.addHook("preHandler", app.auth);
app.addHook("preHandler", app.requireRole(["admin","superadmin"]));
```

| Role | Can access |
| --- | --- |
| `resident` | Resident dashboards (subject to `dashboard_settings` toggles) |
| `admin` | Resident dashboards + Admin · Dashboards + Admin · Controls |
| `superadmin` | Everything, plus role changes on other admins |

Resident dashboard visibility is enforced twice:

1. Frontend hides disabled screens from the sidebar/tabs.
2. Backend read endpoints check `dashboard_settings.enabled` before
   returning data — so disabling a dashboard cannot be bypassed by URL.

## Audit

Every login writes `audit_log(action='login', entity='auth', ip, user_agent)`.
Every mutating admin call writes an entry inside the same transaction as the
change, so audit and data are consistent.
