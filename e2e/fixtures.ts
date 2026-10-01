import { test as base, expect, type Page } from "@playwright/test";
import { months12 } from "../src/lib/finance-mock";

export type Role = "resident" | "admin" | "superadmin";
export type DashboardSetting = { dashboard_key: string; enabled: boolean; hidden_widgets: string[] };

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};
const isoMonths = months12.map((label) => {
  const [mon, yy] = label.split(" '");
  return `20${yy}-${MONTHS[mon]}-01`;
});

const paise = (rupees: number) => String(rupees * 100);

function treeRows(rows: Array<[category: string, vendor: string, lineItem: string, rupees: number]>) {
  return isoMonths.flatMap((month, i) =>
    rows.map(([category, vendor, line_item, rupees]) => ({ category, vendor, line_item, month, amount: paise(rupees + i * 100) })),
  );
}

export const fixtures = {
  monthlyTotals: isoMonths.map((month, i) => ({
    month,
    collection_paise: paise(500000 + i * 1000),
    expense_paise: paise(400000 + i * 800),
    net_paise: paise(100000 + i * 200),
  })),
  balanceStrip: { opening: paise(1000000), income: paise(6000000), expense: paise(4800000), net: paise(1200000), closing: paise(2200000) },
  incomeTree: treeRows([
    ["Maintenance Collections", "Residents", "Maintenance Charge", 450000],
    ["Commercial Income", "Shop Tenants", "Shop Rent", 25000],
    ["Penalties", "Residents", "Late Payment Fine", 5000],
    ["Maintenance Outstanding", "Residents", "Current Month Unpaid Maintenance", 30000],
    ["Maintenance Outstanding", "Residents", "Previous Arrears Brought Forward", 90000],
    ["Expected Collection Reference", "Reference", "Expected Collection", 480000],
    ["Maintenance Rate Reference", "Reference", "Rate", 400],
  ]),
  expenseTree: treeRows([
    ["Utilities", "Power Co", "Common area electricity", 150000],
    ["Security", "Guard Services", "Guards", 120000],
    ["Housekeeping", "Clean Co", "Cleaning", 80000],
  ]),
  categoryTotals: [{ name: "Utilities", total: paise(1800000) }, { name: "Security", total: paise(1400000) }],
  vendorRanking: [{ vendor: "Power Co", kind: "company", category: "Utilities", total: paise(1800000), months_active: 12 }],
};

type MockApi = {
  settings: DashboardSetting[];
  patches: DashboardSetting[][];
  unhandled: string[];
};

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

export async function mockApi(page: Page, settings: DashboardSetting[] = []): Promise<MockApi> {
  const state: MockApi = { settings, patches: [], unhandled: [] };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/admin/settings/dashboards") {
      if (method === "PATCH") {
        const body = request.postDataJSON() as DashboardSetting[];
        state.patches.push(body);
        state.settings = body;
        return route.fulfill(json(body));
      }
      return route.fulfill(json(state.settings));
    }

    const responses: Record<string, unknown> = {
      "/api/dashboard/monthly-totals": fixtures.monthlyTotals,
      "/api/dashboard/balance-strip": fixtures.balanceStrip,
      "/api/income/tree": fixtures.incomeTree,
      "/api/expenses/tree": fixtures.expenseTree,
      "/api/income/category-totals": fixtures.categoryTotals,
      "/api/expenses/category-totals": fixtures.categoryTotals,
      "/api/expenses/anomalies": [],
      "/api/vendors/ranking": fixtures.vendorRanking,
      "/api/collections": [],
      "/api/reports": { rows: [] },
      "/api/admin/transactions": { rows: [], total: 0 },
      "/api/admin/residents": [],
      "/api/admin/audit": { rows: [], total: 0 },
      "/api/admin/imports": [],
      "/api/admin/etl/sessions": [],
      "/api/me": { user: { email: "test@example.com", name: "Test User" } },
      "/api/auth/logout": { ok: true },
    };
    if (pathname in responses) return route.fulfill(json(responses[pathname]));

    state.unhandled.push(`${method} ${pathname}`);
    return route.fulfill(json([]));
  });

  return state;
}

export async function signIn(page: Page, role: Role) {
  const session = {
    email: `${role}@example.com`,
    name: role === "resident" ? "Test Resident" : "Test Admin",
    flatCode: role === "resident" ? "C-G11" : null,
    role,
    issuedAt: Date.now(),
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem("apf.session", value);
  }, JSON.stringify(session));
}

export const allResidentDashboards = (enabled = true): DashboardSetting[] =>
  ["overview", "drilldown", "cashflow", "income", "balance", "forecasting"].map((key) => ({
    dashboard_key: `resident.${key}`,
    enabled,
    hidden_widgets: [],
  }));

export function withSetting(settings: DashboardSetting[], key: string, patch: Partial<DashboardSetting>) {
  return settings.map((s) => (s.dashboard_key === key ? { ...s, ...patch } : s));
}

// Fails a test on any uncaught browser exception, which is how most "page went blank" regressions surface.
export const test = base.extend<{ pageErrors: string[]; allowedPageErrors: RegExp[] }>({
  allowedPageErrors: [[], { option: true }],
  pageErrors: [async ({ page, allowedPageErrors }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      if (!allowedPageErrors.some((re) => re.test(err.message))) errors.push(err.message);
    });
    await use(errors);
    expect(errors, "uncaught browser errors").toEqual([]);
  }, { auto: true }],
});

export { expect };
