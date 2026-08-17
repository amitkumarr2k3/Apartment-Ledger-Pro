// TanStack Query hooks. Each hook normalises backend rows (paise, ISO dates)
// into the shapes the mock exports use, so screens are drop-in compatible.
// API hooks normalise backend rows into the shapes the prototype screens use.
// In authenticated mode they must not mask DB cleanup/API errors with mock data.
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getSession } from "@/lib/session";
import * as mock from "@/lib/finance-mock";
import * as api from "@/lib/api";

// ---- admin.settings dashboard visibility (real backend, not mock) ----
// FIX (2026-08-15): admin/settings previously used seedDashboardControls
// (hardcoded mock data) and "Save changes" never called any API at all --
// toggles only mutated local component state. This wires the REAL
// GET/PATCH /api/admin/settings/dashboards endpoints (confirmed already
// implemented and working in admin.settings.ts on the backend).
export type DashboardSettingRow = {
  dashboard_key: string;
  enabled: boolean;
  hidden_widgets: string[];
};

export function useDashboardSettings() {
  return useQuery({
    queryKey: ["dashboard-settings", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async (): Promise<DashboardSettingRow[]> => {
      try {
        const r = await fetch("/api/admin/settings/dashboards", authHeaders());
        if (!r.ok) return [];
        const rows = await r.json();
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });
}

export async function saveDashboardSettings(rows: DashboardSettingRow[]): Promise<boolean> {
  try {
    // FIX (2026-08-15): authHeaders() returns a full RequestInit shape --
    // { headers: { Authorization: ... } } -- meant to be passed directly as
    // fetch's second argument (as every GET call in this file does:
    // fetch(url, authHeaders())). Spreading it AS a headers object (the
    // mistake here) nested it one level too deep -- { "Content-Type": ...,
    // headers: { Authorization: ... } } -- so the real Authorization header
    // was never actually sent, and every save silently hit the backend
    // unauthenticated (401), even though the GET calls elsewhere worked
    // fine. Extract .headers explicitly to get the flat shape this spread
    // actually needs.
    const auth = authHeaders();
    const r = await fetch("/api/admin/settings/dashboards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(auth.headers ?? {}) },
      body: JSON.stringify(rows),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Convenience hook for resident pages: given this page's dashboard_key and
// a specific widget id, returns whether that widget should render. If no
// settings row exists yet for this dashboard (nothing ever saved), defaults
// to fully visible -- so this never hides anything until an admin
// explicitly turns something off.
export function useWidgetVisibility(dashboardKey: string) {
  // FIX (2026-08-15): SSR pages render before any client-side data fetch can
  // run (fetches are gated on window/localStorage, which don't exist on the
  // server), so the server-rendered HTML always shows "everything visible."
  // If the client's first paint used the REAL fetched settings immediately,
  // it could render differently than what the server sent down -- a
  // hydration mismatch (this is very likely what caused the crash you saw,
  // matching the "React error #418" in the console). The fix: report
  // "everything visible" until this component has actually mounted on the
  // client, matching the server's output exactly, THEN switch to the real
  // settings on the next render. This trades one harmless render flash for
  // never crashing on a mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const { data: settings = [] } = useDashboardSettings();

  // FIX (2026-08-15): Dashboard Controls restrictions apply ONLY to actual
  // residents. Admins/superadmins always see the full dashboard regardless
  // of what's hidden for residents -- by design decision, since limiting an
  // admin's own visibility into their own community's data serves no real
  // purpose, and "Preview as resident" is meant for checking layout/UX, not
  // for literally hiding data from an admin viewing their own session.
  // getSession() safely returns null during SSR/before mount (matching the
  // `mounted` guard above), so this doesn't reintroduce a hydration risk.
  const session = mounted ? getSession() : null;
  const isAdminOrAbove = session?.role === "admin" || session?.role === "superadmin";

  const row = settings.find((s) => s.dashboard_key === dashboardKey);
  const dashboardEnabled = !mounted || isAdminOrAbove ? true : (row?.enabled ?? true);
  const hiddenWidgets = !mounted || isAdminOrAbove ? [] : (row?.hidden_widgets ?? []);
  const isWidgetVisible = (widgetId: string) => dashboardEnabled && !hiddenWidgets.includes(widgetId);
  return { dashboardEnabled, hiddenWidgets, isWidgetVisible };
}

// ---- Audited Report widget ----
export type AuditedReport = {
  id: string;
  fiscal_year: string;
  title?: string | null;
  file_name: string;
  mime_type?: string;
  uploaded_at: string;
};

export function useAuditedReports() {
  return useQuery({
    queryKey: ["audited-reports", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async (): Promise<AuditedReport[]> => {
      try {
        const r = await fetch("/api/reports", authHeaders());
        if (!r.ok) return [];
        const j = await r.json();
        return Array.isArray(j.rows) ? j.rows : [];
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });
}

// Superadmin-only. fiscalYear must match exactly what the FY selector shows
// (e.g. "FY 2026-27") so useAuditedReports() lookups by label line up.
export async function uploadAuditedReport(fiscalYear: string, file: File): Promise<boolean> {
  try {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const auth = authHeaders();
    const r = await fetch(`/api/reports/${encodeURIComponent(fiscalYear)}`, {
      method: "POST",
      headers: { ...(auth.headers ?? {}) },
      body: fd,
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteAuditedReport(id: string): Promise<boolean> {
  try {
    const auth = authHeaders();
    const r = await fetch(`/api/reports/${id}`, {
      method: "DELETE",
      headers: { ...(auth.headers ?? {}) },
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Fetches the PDF bytes WITH the Authorization header attached, then hands
// back a local blob: URL. This is required for viewing -- a plain
// <iframe src="/api/reports/:id/file"> sends NO Authorization header at all,
// since browsers only auto-attach cookies on navigation/embeds, never custom
// headers, and this app's auth token lives in localStorage, not a cookie.
// Caller is responsible for URL.revokeObjectURL(...) once done with it.
export async function fetchAuditedReportFileUrl(id: string): Promise<string | null> {
  try {
    const auth = authHeaders();
    const r = await fetch(`/api/reports/${id}/file`, { headers: { ...(auth.headers ?? {}) } });
    if (!r.ok) return null;
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// ---- vendor ranking ----
export function useVendorRanking() {
  return useQuery({
    queryKey: ["vendor-ranking", authCacheKey()],
    queryFn: async () => {
      const rows: any[] = await api.getVendorRanking();
      if (!Array.isArray(rows)) return [];
      // Backend shape: { vendor, kind, category, total, months_active }
      // categories may be an array. Normalise to mock's { vendor, category, kind, total, monthsActive, changePct, monthly }
      return rows.map((r) => ({
        vendor: r.vendor,
        kind: (r.kind ?? "company") as "company" | "individual",
        category: Array.isArray(r.category) ? r.category.join(", ") : (r.category ?? "—"),
        total: paiseToRupees(r.total),
        monthsActive: Number(r.months_active ?? r.monthsActive ?? 0),
        changePct: Number(r.changePct ?? 0),
        monthly: [] as number[],
      }));
    },
    staleTime: 60_000,
  });
}

// ---- normalisers ----
const paiseToRupees = (n: unknown) => Math.round(Number(n ?? 0) / 100);

function hasPaiseTotal(rows: any[]): boolean {
  return Array.isArray(rows) && rows.length > 0 && rows.some((r) => r && typeof r === "object" && "total" in r);
}

// Normalise any date-ish value (JS Date, ISO string with time, "YYYY-MM-DD")
// into a plain YYYY-MM-DD string for display.
function toYmd(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function isoMonthToLabel(iso: string | Date): string {
  // Parse year-month directly from the ISO string to avoid local-timezone skew.
  // Postgres DATE columns arrive as "YYYY-MM-DD" or "YYYY-MM-DDT00:00:00.000Z";
  // both start with YYYY-MM which we can slice without creating a Date object.
  const s = iso instanceof Date ? iso.toISOString() : String(iso);
  const yr4 = s.slice(0, 4);
  const mo2 = s.slice(5, 7);
  const monthIdx = Number(mo2) - 1; // 0-indexed
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return s;
  const ABBRS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${ABBRS[monthIdx]} '${yr4.slice(-2)}`;
}

function looksLikeBackendMonthly(rows: any[]): boolean {
  return Array.isArray(rows) && rows.length > 0 && "collection_paise" in rows[0];
}

function authCacheKey() {
  if (typeof window === "undefined") return "ssr";
  return window.localStorage.getItem("apf.token") ? "token" : "anon";
}

function hasStoredAuth(): boolean {
  return typeof window !== "undefined"
    && (!!window.localStorage.getItem("apf.token") || !!window.localStorage.getItem("apf.session"));
}

// ---- resident.overview ----
export function useMonthlyTotals() {
  return useQuery({
    queryKey: ["monthly-totals", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async () => {
      const raw = await api.getMonthlyTotals();
      if (looksLikeBackendMonthly(raw as any[])) {
        return (raw as any[]).map((r) => ({
          month: isoMonthToLabel(r.month),
          collection: paiseToRupees(r.collection_paise),
          expense: paiseToRupees(r.expense_paise),
          net: paiseToRupees(r.net_paise),
        }));
      }
      return [] as Array<{ month: string; collection: number; expense: number; net: number }>;
    },
    staleTime: 10_000,
  });
}

export function useBalanceStrip() {
  return useQuery({
    queryKey: ["balance-strip", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async () => {
      const r: any = await api.getBalanceStrip();
      if (r && "opening" in r && "closing" in r) {
        // Backend returns paise. pg may serialise BIGINT columns as strings,
        // and valid empty data is all zeros, so don't use truthy/size checks.
        return {
          opening: paiseToRupees(r.opening),
          income: paiseToRupees(r.income),
          expense: paiseToRupees(r.expense),
          net: paiseToRupees(r.net),
          closing: paiseToRupees(r.closing),
        };
      }
      return { opening: 0, income: 0, expense: 0, net: 0, closing: 0 };
    },
    staleTime: 60_000,
  });
}

export function useIncomeCategoryTotals() {
  return useQuery({
    queryKey: ["income-cat-totals", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async () => {
      const r: any[] = await api.getIncomeCategoryTotals();
      if (hasPaiseTotal(r)) {
        return r.map((x) => ({ name: x.name, total: paiseToRupees(x.total) }));
      }
      return [] as Array<{ name: string; total: number }>;
    },
    staleTime: 60_000,
  });
}

export function useExpenseCategoryTotals() {
  return useQuery({
    queryKey: ["expense-cat-totals", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async () => {
      const r: any[] = await api.getExpenseCategoryTotals();
      if (hasPaiseTotal(r)) {
        return r.map((x) => ({ name: x.name, total: paiseToRupees(x.total) }));
      }
      return [] as Array<{ name: string; total: number }>;
    },
    staleTime: 60_000,
  });
}

// ---- admin.income ----
// Backend /income/tree returns flat rows {category, vendor, line_item, month, amount(paise)}.
// We re-nest into the mock's Category[] shape so admin.income can stay the same.
export function useIncomeTree() {
  return useQuery({
    queryKey: ["income-tree", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async () => {
      try {
        const r = await fetch("/api/income/tree", authHeaders());
        if (!r.ok) return [];
        const rows: any[] = await r.json();
        return Array.isArray(rows) ? buildTree(rows) : [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });
}

// Same shape as useIncomeTree but for expenses. Backend /expenses/tree
// returns the same flat row shape (adds `head` column we ignore).
export function useExpenseTree() {
  return useQuery({
    queryKey: ["expense-tree", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async () => {
      try {
        const r = await fetch("/api/expenses/tree", authHeaders());
        if (!r.ok) return [];
        const rows: any[] = await r.json();
        return Array.isArray(rows) ? buildTree(rows) : [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });
}

// Extra fields beyond mock.TxnRow: the real UUIDs needed to PATCH/DELETE a
// transaction or to build category/head/vendor pickers for new transactions.
// (finance-mock.ts's TxnRow doesn't declare these -- rather than edit that
// shared mock file, we widen the return type inline with an intersection.)
export type AdminTxnRow = mock.TxnRow & {
  categoryId?: string;
  headId?: string;
  vendorId?: string;
  flatId?: string;
};

// ---- admin.transactions ----
export function useAdminTransactions() {
  return useQuery({
    queryKey: ["admin-transactions", authCacheKey()],
    enabled: hasStoredAuth(),
    queryFn: async (): Promise<AdminTxnRow[]> => {
      try {
        // FIX (2026-08-15): confirmed against backend/src/routes/admin.transactions.ts:
        // GET / validates `pageSize` with Zod .max(200) -- anything above 200 makes
        // .parse() throw, which the app has no handler for, so Fastify returns a
        // bare 500. `page` itself is fully supported and the response already
        // includes `total`, so we page through at the max allowed size (200)
        // until we've collected everything the backend reports.
        const pageSize = 200; // matches backend schema's hard max -- do not increase
        let page = 1;
        let all: any[] = [];
        let total = Infinity;
        while (all.length < total && page <= 50) { // safety cap: 50 pages = 10,000 rows
          const r = await fetch(`/api/admin/transactions?pageSize=${pageSize}&page=${page}`, authHeaders());
          if (!r.ok) throw new Error(String(r.status));
          const j = await r.json();
          const rows: any[] = Array.isArray(j.rows) ? j.rows : [];
          if (rows.length === 0) break;
          all = all.concat(rows);
          total = typeof j.total === "number" ? j.total : all.length;
          page += 1;
        }
        return all.map((t): AdminTxnRow => ({
          // FIX (2026-08-15): id used to be t.id?.slice(0, 8) -- an 8-character
          // truncation of the UUID. That's fine for a display label, but it
          // silently broke Edit/Delete, since the backend's PATCH/:id and
          // DELETE/:id routes validate the id with z.string().uuid() and would
          // reject the truncated value. We now keep the full UUID.
          id: t.id ?? "-",
          date: toYmd(t.txn_date),
          month: isoMonthToLabel(t.period_month),
          head: t.head_kind,
          category: t.category_name,
          vendor: t.vendor_name ?? undefined,
          lineItem: t.line_item_name ?? "",
          flat: t.flat_code ?? undefined,
          amount: paiseToRupees(t.amount_paise),
          direction: t.direction,
          notes: t.notes ?? "",
          source: t.source ?? "manual",
          // FIX (2026-08-15): the backend's SELECT t.*, ... already returns these
          // raw UUID columns -- they were just being discarded here. Keeping them
          // lets admin.transactions.tsx send real category_id/head_id/vendor_id
          // on create/update instead of unusable name strings.
          categoryId: t.category_id ?? undefined,
          headId: t.head_id ?? undefined,
          vendorId: t.vendor_id ?? undefined,
          flatId: t.flat_id ?? undefined,
        }));
      } catch {
        return hasStoredAuth() ? [] : (mock.seedTransactions as AdminTxnRow[]);
      }
    },
    staleTime: 30_000,
  });
}

// ---- helpers ----
function authHeaders(): RequestInit {
  if (typeof window === "undefined") return {};
  const t = window.localStorage.getItem("apf.token");
  return t ? { headers: { Authorization: `Bearer ${t}` } } : {};
}

function buildTree(rows: any[]): mock.Category[] {
  // Use mock.months12 as the canonical month index so that sliceMonthly (which
  // assumes numeric monthly[] arrays are aligned to months12) works correctly.
  const orderedMonths = mock.months12;
  const byCat = new Map<string, mock.Category>();
  for (const r of rows) {
    const catName = r.category ?? "Uncategorised";
    let cat = byCat.get(catName);
    if (!cat) { cat = { name: catName, vendors: [] }; byCat.set(catName, cat); }
    const vName = r.vendor ?? "—";
    let vend = cat.vendors.find((v) => v.name === vName);
    if (!vend) { vend = { name: vName, kind: (r.vendor_kind ?? "company") as any, items: [] }; cat.vendors.push(vend); }
    const liName = r.line_item ?? "—";
    let li = vend.items.find((i) => i.name === liName);
    if (!li) { li = { name: liName, monthly: new Array(orderedMonths.length).fill(0) }; vend.items.push(li); }
    const label = isoMonthToLabel(r.month);
    const idx = orderedMonths.indexOf(label);
    if (idx >= 0) li.monthly[idx] = paiseToRupees(r.amount);
  }
  return Array.from(byCat.values());
}
