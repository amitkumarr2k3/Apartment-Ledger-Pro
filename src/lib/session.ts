// Mock session + OTP layer for the prototype.
// In production this is replaced by /api/auth/request-otp + /api/auth/verify-otp
// (see backend/src/routes/auth.ts). The whitelist here mirrors the
// `allowed_emails` table by reading `seedResidents` from the mock — an email
// is eligible for OTP only when its row is `status: "active"`. Revoked/invited
import { seedResidents, type ResidentRow } from "./finance-mock";
import { AUTH_ENABLED, GUEST_SESSION } from "./feature-flags";

export type Session = {
  email: string;
  name: string;
  flatCode?: string | null;
  role: "resident" | "admin";
  issuedAt: number;
};

const SESSION_KEY = "apf.session";
const OTP_KEY = "apf.otp";           // { email, code, expiresAt }
const SUPERADMIN = "admin@example.com"; // matches backend SUPERADMIN_EMAIL default

type StoredOtp = { email: string; code: string; expiresAt: number };

function isBrowser() {
  return typeof window !== "undefined";
}

function normaliseSession(session: Session): Session {
  // Older localStorage sessions may have been written before the superadmin
  // role fix and can incorrectly say `resident`. Always trust the bootstrap
  // superadmin email as an admin on the client, matching backend policy.
  if (session.email?.toLowerCase() === SUPERADMIN) {
    return { ...session, name: session.name || "Super Admin", role: "admin" };
  }
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
    const roles: string[] = Array.isArray(j.user?.roles) ? j.user.roles : [];
    // A user with a valid password hash (accepted by /login-password) is a
    // superadmin by policy — treat as admin even if user_roles is empty.
    const isAdmin =
      roles.includes("admin") ||
      roles.includes("superadmin") ||
      j.user?.email?.toLowerCase() === "admin@example.com";
    const role: "admin" | "resident" = isAdmin ? "admin" : "resident";
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

export function signOut() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem("apf.token");

  window.sessionStorage.removeItem(OTP_KEY);
  window.dispatchEvent(new Event("apf-session-change"));
}

// Simple RBAC map used by the client-side route guard.
export function canAccess(pathname: string, role: "resident" | "admin" | null): boolean {
  if (!AUTH_ENABLED) return true; // login disabled → everything is open
  if (!role) return false;
  if (pathname.startsWith("/admin")) return role === "admin";
  if (pathname.startsWith("/resident")) return role === "resident" || role === "admin";
  return true; // /, /login, misc
}
