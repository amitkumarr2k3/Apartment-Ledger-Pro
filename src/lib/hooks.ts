// TanStack Query hooks. Each hook normalises backend rows (paise, ISO dates)
// into the shapes the mock exports use, so screens are drop-in compatible.
// API hooks normalise backend rows into the shapes the prototype screens use.
// In authenticated mode they must not mask DB cleanup/API errors with mock data.
import { useQuery } from "@tanstack/react-query";
import * as mock from "@/lib/finance-mock";
import * as api from "@/lib/api";

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

function isoMonthToLabel(iso: string): string {
  // "2025-08-01" -> "Aug '25"
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] ?? "Jan";
  const yr = String(d.getFullYear()).slice(-2);
  return `${mon} '${yr}`;
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
    staleTime: 60_000,
  });
}

export function useBalanceStrip() {
  return useQuery({
    queryKey: ["balance-strip", authCacheKey()],
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

// ---- admin.transactions ----
export function useAdminTransactions() {
  return useQuery({
    queryKey: ["admin-transactions", authCacheKey()],
    queryFn: async () => {
      try {
        const r = await fetch("/api/admin/transactions?pageSize=200", authHeaders());
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        return (j.rows as any[]).map((t): mock.TxnRow => ({
          id: t.id?.slice(0, 8) ?? "-",
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
        }));
      } catch {
        return hasStoredAuth() ? [] : mock.seedTransactions;
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
