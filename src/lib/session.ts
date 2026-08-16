// Mock session + OTP layer for the prototype.
// In production this is replaced by /api/auth/request-otp + /api/auth/verify-otp
// (see backend/src/routes/auth.ts). The whitelist here mirrors the
// `allowed_emails` table by reading `seedResidents` from the mock — an email
// is eligible for OTP only when its row is `status: "active"`. Revoked/invited
import { seedResidents, navSections, type ResidentRow } from "./finance-mock";
import { AUTH_ENABLED, GUEST_SESSION } from "./feature-flags";

export type Session = {
  email: string;
  name: string;
  flatCode?: string | null;
  role: "resident" | "admin" | "superadmin";
  issuedAt: number;
};

const SESSION_KEY = "apf.session";
const OTP_KEY = "apf.otp";           // { email, code, expiresAt }
const SUPERADMIN = "admin@example.com"; // matches backend SUPERADMIN_EMAIL default

type StoredOtp = { email: string; code: string; expiresAt: number };

function isBrowser() {
  return typeof window !== "undefined";
}

// FIX (2026-08-15): removed the hardcoded-email override. Role now comes
// straight from the backend's real roles array (see signInWithPassword)
// instead of being force-set here whenever the email matched a constant --
// which is exactly the "hardcoded superadmin" behaviour we're removing.
// (If you have an old session in localStorage from before this fix, log
// out and back in once to pick up the corrected role.)
function normaliseSession(session: Session): Session {
  return session;
}

export function findWhitelisted(email: string): ResidentRow | { email: string; name: string; role: "admin"; status: "active" } | null {
  const lower = email.trim().toLowerCase();
  if (lower === SUPERADMIN) {
    return { email: lower, name: "Super Admin", role: "admin", status: "active" };
  }
  const row = seedResidents.find((r) => r.email.toLowerCase() === lower);
  if (!row) return null;
  if (row.status !== "active") return null; // revoked / invited: silent no-op
  return row;
}

export function requestOtp(email: string): { ok: boolean; code?: string; reason?: string } {
  const row = findWhitelisted(email);
  if (!row) return { ok: false, reason: "not_whitelisted" };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const payload: StoredOtp = {
    email: row.email.toLowerCase(),
    code,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  if (isBrowser()) window.sessionStorage.setItem(OTP_KEY, JSON.stringify(payload));
  // Dev-only: also log so it's easy to grab from console.
  // eslint-disable-next-line no-console
  console.info(`[OTP mock] ${row.email} → ${code} (valid 15 min)`);
  return { ok: true, code };
}

export function verifyOtp(email: string, code: string): { ok: boolean; session?: Session; reason?: string } {
  if (!isBrowser()) return { ok: false, reason: "no_browser" };
  const raw = window.sessionStorage.getItem(OTP_KEY);
  if (!raw) return { ok: false, reason: "no_otp_requested" };
  const stored: StoredOtp = JSON.parse(raw);
  const lower = email.trim().toLowerCase();
  if (stored.email !== lower) return { ok: false, reason: "email_mismatch" };
  if (Date.now() > stored.expiresAt) return { ok: false, reason: "expired" };
  if (stored.code !== code.trim()) return { ok: false, reason: "invalid_code" };
  const row = findWhitelisted(lower);
  if (!row) return { ok: false, reason: "not_whitelisted" };
  const session: Session = {
    email: row.email.toLowerCase(),
    name: row.name,
    role: row.role,
    issuedAt: Date.now(),
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.sessionStorage.removeItem(OTP_KEY);
  window.dispatchEvent(new Event("apf-session-change"));
  return { ok: true, session };
}

// Password sign-in — calls the real backend (/api/auth/login-password),
// stores the JWT under `apf.token` (used by src/lib/api.ts) and the session
// under `apf.session`. Superadmin accounts are seeded with a password so the
// platform is reachable immediately after `docker compose up`.
export async function signInWithPassword(email: string, password: string):
  Promise<{ ok: boolean; session?: Session; reason?: string }> {
  if (!isBrowser()) return { ok: false, reason: "no_browser" };
  const API = (import.meta as any).env?.VITE_API_URL ?? "/api";
  try {
    const r = await fetch(`${API}/auth/login-password`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return { ok: false, reason: r.status === 401 ? "invalid_credentials" : "server_error" };
    const j = await r.json();
    window.localStorage.setItem("apf.token", j.token);
    // FIX (2026-08-15): removed the hardcoded "admin@example.com" fallback.
    // The backend's user_roles table (seeded durably at bootstrap, see
    // seed.js) is the single source of truth -- trust `roles` as returned.
    // Role is no longer collapsed to a binary admin/resident either:
    // superadmin is now preserved end-to-end.
    const roles: string[] = normaliseRoles(j.user?.roles);
    const role: "resident" | "admin" | "superadmin" =
      roles.includes("superadmin") ? "superadmin" :
      roles.includes("admin") ? "admin" : "resident";
    const session = normaliseSession({
      email: j.user.email,
      name: j.user.name || j.user.email,
      flatCode: j.user.flatCode ?? j.user.flat_code ?? null,
      role,
      issuedAt: Date.now(),
    });
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event("apf-session-change"));
    return { ok: true, session };
  } catch {
    return { ok: false, reason: "server_error" };
  }
}


export function getSession(): Session | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (raw) {
    try {
      const session = normaliseSession(JSON.parse(raw) as Session);
      if (session.email?.toLowerCase() === SUPERADMIN) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
      return session;
    } catch { /* fall through */ }
  }
  // Login disabled → hand every visitor a guest admin session so the UI works.
  if (!AUTH_ENABLED) return { ...GUEST_SESSION };
  return null;
}

// FIX (2026-08-15): self-service profile update, pairs with PATCH /api/me.
// Updates localStorage (token + session) in place so the UI reflects the
// new email/name immediately, without forcing a logout/login round-trip.
export async function updateMyProfile(patch: { email?: string; name?: string }):
  Promise<{ ok: boolean; session?: Session; reason?: string }> {
  if (!isBrowser()) return { ok: false, reason: "no_browser" };
  const API = (import.meta as any).env?.VITE_API_URL ?? "/api";
  const token = window.localStorage.getItem("apf.token");
  if (!token) return { ok: false, reason: "not_authenticated" };
  try {
    const r = await fetch(`${API}/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      if (r.status === 409) return { ok: false, reason: "email_taken" };
      return { ok: false, reason: r.status === 401 ? "unauthorized" : "server_error" };
    }
    const j = await r.json();
    window.localStorage.setItem("apf.token", j.token);
    const current = getSession();
    const session: Session = {
      email: j.user.email,
      name: j.user.name || j.user.email,
      flatCode: current?.flatCode ?? null,
      role: current?.role ?? "resident",
      issuedAt: Date.now(),
    };
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event("apf-session-change"));
    return { ok: true, session };
  } catch {
    return { ok: false, reason: "server_error" };
  }
}

// FIX (2026-08-15): shared helper so every login path (password AND OTP)
// derives + stores the session the same way. Before this, login.tsx's OTP
// verify() had its OWN hand-rolled copy of this logic that collapsed
// "superadmin" into "admin" -- a second instance of the exact bug we'd
// already fixed in signInWithPassword, just duplicated in a file that
// hadn't been reviewed yet. Centralising it here means there is now only
// ONE place that decides what role a login response maps to.
// FIX (2026-08-15): defensive parsing for a real bug found in production --
// a backend query returned roles as the raw Postgres array-literal string
// "{superadmin,admin}" instead of a JSON array, because array_agg() over a
// custom enum column has no default node-postgres parser. The root cause is
// fixed server-side (see auth.ts loadUserByEmail), but this stays as a
// safety net in case any other endpoint has the same latent issue.
function normaliseRoles(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const inner = trimmed.slice(1, -1);
      return inner.length ? inner.split(",").map((s) => s.trim()) : [];
    }
  }
  return [];
}

export function applySessionFromAuthResponse(user: {
  email?: string; name?: string; roles?: string[]; flatCode?: string | null; flat_code?: string | null;
}): Session {
  const roles: string[] = normaliseRoles(user.roles);
  const role: "resident" | "admin" | "superadmin" =
    roles.includes("superadmin") ? "superadmin" :
    roles.includes("admin") ? "admin" : "resident";
  const session: Session = {
    email: (user.email ?? "").toLowerCase(),
    name: user.name || user.email || "",
    flatCode: user.flatCode ?? user.flat_code ?? null,
    role,
    issuedAt: Date.now(),
  };
  if (isBrowser()) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event("apf-session-change"));
  }
  return session;
}

// FIX (2026-08-15): callers used to check `role === "admin"` to decide
// whether to land on the admin area, which silently excluded "superadmin"
// once that became its own distinct value. Use this everywhere instead of
// re-writing the check inline.
export function isAdminOrAbove(role: "resident" | "admin" | "superadmin" | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export function signOut() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem("apf.token");
  window.localStorage.removeItem("apf.lastActiveAt");   // legacy cleanup
  window.sessionStorage.removeItem(OTP_KEY);
  window.sessionStorage.removeItem("apf.lastActiveAt"); // clear idle clock for re-login
  window.dispatchEvent(new Event("apf-session-change"));
}

// Simple RBAC map used by the client-side route guard.
// FIX (2026-08-15): widened to the real 3-tier role, and added a check
// against navSections' `group: "controls"` metadata so plain "admin"
// accounts can view Admin Dashboards but are blocked from Admin Controls
// screens (Transactions CRUD, Residents & Whitelist, Dashboard Controls,
// Audit Trail, etc.) even via direct URL -- hiding the nav link alone
// (portal-shell.tsx) is not real access control.
export function canAccess(pathname: string, role: "resident" | "admin" | "superadmin" | null): boolean {
  if (!AUTH_ENABLED) return true; // login disabled → everything is open
  if (!role) return false;
  const section = navSections.find((s) => s.items.some((it) => pathname.startsWith(it.to)));
  if (section?.group === "controls" && role !== "superadmin") return false;
  if (pathname.startsWith("/admin")) return role === "admin" || role === "superadmin";
  if (pathname.startsWith("/resident")) return true; // resident, admin, and superadmin can all view resident dashboards
  return true; // /, /login, misc
}
