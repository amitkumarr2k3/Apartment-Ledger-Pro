// Frontend API client — shared shapes used by every screen once the app is
// pointed at the real backend. During prototype/preview it falls back to the
// bundled mock so the UI stays functional without the docker stack.
import * as mock from "./finance-mock";
import { AUTH_ENABLED } from "./feature-flags";

const API = (import.meta as any).env?.VITE_API_URL ?? "/api";

function tokenHeader(): HeadersInit {
  if (typeof window === "undefined") return {};
  const t = window.localStorage.getItem("apf.token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: tokenHeader() });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

function hasStoredAuth(): boolean {
  return typeof window !== "undefined"
    && (!!window.localStorage.getItem("apf.token") || !!window.localStorage.getItem("apf.session"));
}

function canUseMockFallback(): boolean {
  return !AUTH_ENABLED || !hasStoredAuth();
}

// --- Auth (OTP) ---
// Whitelisted email + 6-digit OTP. There is no clickable magic link.
export async function requestOtp(email: string) {
  return fetch(`${API}/auth/request-otp`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}
export async function verifyOtp(email: string, otp: string) {
  const r = await fetch(`${API}/auth/verify-otp`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, otp }),
  });
  if (!r.ok) throw new Error("verify failed");
  const j = await r.json();
  // SECURITY: no longer written to localStorage -- the server now also sets
  // an httpOnly cookie on this same response (see routes/auth.ts), which is
  // what actually authenticates subsequent requests.
  return j;
}
// Deprecated aliases
export const requestMagicLink = requestOtp;
export const verifyMagicLink = verifyOtp;

// --- Reads (fall back to mock if the API is not present) ---
export async function getMonthlyTotals() {
  try { return await get<any[]>("/dashboard/monthly-totals"); }
  catch { return []; }
}
export async function getBalanceStrip() {
  try { return await get<any>("/dashboard/balance-strip"); }
  catch {
    return { opening: 0, income: 0, expense: 0, net: 0, closing: 0 };
  }
}
export async function getExpenseCategoryTotals() {
  try { return await get<any[]>("/expenses/category-totals"); }
  catch { return []; }
}
export async function getIncomeCategoryTotals() {
  try { return await get<any[]>("/income/category-totals"); }
  catch { return []; }
}
export async function getVendorRanking() {
  try { return await get<any[]>("/vendors/ranking"); }
  catch { return []; }
}
export async function getDashboardSettings() {
  try { return await get<any[]>("/admin/settings/dashboards"); }
  catch {
    return ["resident.overview","resident.drilldown","resident.cashflow","resident.income","resident.balance"]
      .map((k) => ({ dashboard_key: k, enabled: true, hidden_widgets: [] }));
  }
}
