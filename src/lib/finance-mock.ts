// Mock data for the Apartment Ledger Pro prototype screens.
// All figures are illustrative only.

export const inr = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Math.round(n));
  // Indian numbering: 1,25,000
  const s = v.toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const withCommas = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${sign}₹${withCommas}`;
};

export const pct = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

export const months12 = [
  "Aug '25", "Sep '25", "Oct '25", "Nov '25", "Dec '25", "Jan '26",
  "Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26", "Jul '26",
];

// Monthly totals (community-level)
export const monthlyTotals = months12.map((m, i) => {
  const collection = 380000 + Math.round(Math.sin(i / 2) * 25000) + i * 1500;
  const expense = 320000 + Math.round(Math.cos(i / 2.2) * 40000) + i * 2200;
  return {
    month: m,
    collection,
    expense,
    net: collection - expense,
  };
});

export const openingBalanceStart = 850000;

export const balanceStrip = (() => {
  const opening = openingBalanceStart;
  const income = monthlyTotals.reduce((s, r) => s + r.collection, 0);
  const expense = monthlyTotals.reduce((s, r) => s + r.expense, 0);
  return {
    opening,
    income,
    expense,
    net: income - expense,
    closing: opening + income - expense,
  };
})();

// Expense hierarchy: Head → Category → Vendor → Line item
export type LineItem = { name: string; monthly: number[] };
export type Vendor = { name: string; kind: "company" | "individual"; items: LineItem[] };
export type Category = { name: string; vendors: Vendor[] };

const fill = (base: number, jitter: number, sparse: number[] = []) =>
  months12.map((_, i) =>
    sparse.includes(i) ? 0 : Math.max(0, Math.round(base + (Math.sin(i) * jitter))),
  );

export const expenseTree: Category[] = [
  {
    name: "Utilities",
    vendors: [
      {
        name: "Bescom",
        kind: "company",
        items: [
          { name: "Common area electricity", monthly: fill(48000, 4000) },
          { name: "Backup usage", monthly: fill(12000, 3500, [2, 8]) },
        ],
      },
      {
        name: "BWSSB",
        kind: "company",
        items: [{ name: "Water charges", monthly: fill(32000, 2000) }],
      },
    ],
  },
  {
    name: "Maintenance",
    vendors: [
      {
        name: "ABC Enterprise",
        kind: "company",
        items: [
          { name: "Labour charges", monthly: fill(65000, 3000) },
          { name: "Spare parts", monthly: fill(18000, 6000, [1, 4, 7]) },
          { name: "STP salt purchase", monthly: fill(9000, 500, [0, 1, 3, 4, 6, 7, 9, 10]) },
        ],
      },
      {
        name: "John (Plumber)",
        kind: "individual",
        items: [{ name: "Plumbing repair", monthly: fill(4500, 3500, [0, 2, 5, 6, 8, 11]) }],
      },
    ],
  },
  {
    name: "Security",
    vendors: [
      {
        name: "SafeGuard Services",
        kind: "company",
        items: [{ name: "Guard salaries", monthly: fill(120000, 2000) }],
      },
    ],
  },
  {
    name: "Housekeeping",
    vendors: [
      {
        name: "CleanCo",
        kind: "company",
        items: [
          { name: "Staff wages", monthly: fill(58000, 1500) },
          { name: "Cleaning supplies", monthly: fill(7500, 1500) },
        ],
      },
    ],
  },
  {
    name: "Petty Cash",
    vendors: [
      {
        name: "Office petty cash",
        kind: "individual",
        items: [{ name: "Ad-hoc expenses", monthly: fill(6000, 5500) }],
      },
    ],
  },
];

export const incomeTree: Category[] = [
  {
    name: "Maintenance Collections",
    vendors: [
      {
        name: "Monthly maintenance",
        kind: "company",
        items: [{ name: "Flat maintenance dues", monthly: fill(340000, 15000) }],
      },
    ],
  },
  {
    name: "Other Income",
    vendors: [
      {
        name: "Community Hall",
        kind: "company",
        items: [
          { name: "Hall rental", monthly: fill(18000, 8000, [1, 5, 9]) },
          { name: "Event usage charges", monthly: fill(6000, 4500, [0, 2, 4, 6, 8, 10]) },
        ],
      },
      {
        name: "Signage Rental",
        kind: "individual",
        items: [{ name: "Billboard fee", monthly: fill(12000, 500) }],
      },
    ],
  },
];

// Aggregate helpers
export const sumMonthly = (arrs: number[][]) =>
  months12.map((_, i) => arrs.reduce((s, a) => s + (a[i] ?? 0), 0));

export const vendorMonthly = (v: Vendor) => sumMonthly(v.items.map((i) => i.monthly));
export const categoryMonthly = (c: Category) => sumMonthly(c.vendors.map(vendorMonthly));
export const total = (arr: number[]) => arr.reduce((s, n) => s + n, 0);

export const expenseCategoryTotals = expenseTree
  .map((c) => ({ name: c.name, total: total(categoryMonthly(c)) }))
  .sort((a, b) => b.total - a.total);

export const incomeCategoryTotals = incomeTree.map((c) => ({
  name: c.name,
  total: total(categoryMonthly(c)),
}));

// Vendor ranking (flat, expense only)
export const vendorRanking = expenseTree
  .flatMap((c) =>
    c.vendors.map((v) => {
      const m = vendorMonthly(v);
      const t = total(m);
      const monthsActive = m.filter((x) => x > 0).length;
      const firstHalf = total(m.slice(0, 6)) || 1;
      const secondHalf = total(m.slice(6));
      const changePct = ((secondHalf - firstHalf) / firstHalf) * 100;
      return {
        vendor: v.name,
        category: c.name,
        kind: v.kind,
        total: t,
        monthly: m,
        monthsActive,
        changePct,
      };
    }),
  )
  .sort((a, b) => b.total - a.total);

// Anomaly detection: current month > 2x average of previous 3 months
export const anomalies = expenseTree
  .map((c) => {
    const m = categoryMonthly(c);
    const cur = m[m.length - 1];
    const prev3 = m.slice(-4, -1);
    const avg = prev3.reduce((s, n) => s + n, 0) / 3;
    const ratio = cur / (avg || 1);
    return { category: c.name, cur, avg, ratio };
  })
  .filter((a) => a.ratio >= 1.5)
  .sort((a, b) => b.ratio - a.ratio);

// MoM % change per category
export const momChanges = expenseTree.map((c) => {
  const m = categoryMonthly(c);
  const cur = m[m.length - 1];
  const prev = m[m.length - 2] || 1;
  const change = ((cur - prev) / prev) * 100;
  const period = total(m);
  const prevPeriod = total(m.slice(0, -1)) / (m.length - 1);
  const periodChange = ((cur - prevPeriod) / prevPeriod) * 100;
  return { category: c.name, current: cur, previous: prev, change, periodChange };
});

// Nav structure — Admin is split into "Dashboards" (analytics) and
// "Controls" (administrative CRUD/audit) so the two surfaces are separate.
export const navSections = [
  {
    label: "Resident",
    tone: "resident" as const,
    group: "dashboards" as const,
    items: [
      { to: "/resident/overview", label: "Overview", req: "RD-01 → RD-05" },
      { to: "/resident/drilldown", label: "Head Drill-down", req: "RD-10 → RD-15" },
      { to: "/resident/cashflow", label: "Cashflow Health", req: "RD-20 → RD-23" },
      { to: "/resident/income", label: "Income Visibility", req: "RD-30 → RD-32" },
      { to: "/resident/balance", label: "Opening & Closing", req: "RD-40 → RD-44" },
    ],
  },
  {
    label: "Admin · Dashboards",
    tone: "admin" as const,
    group: "dashboards" as const,
    items: [
      { to: "/admin/actions", label: "Action Needed", req: "AD-40 → AD-43" },
      { to: "/admin/alerts", label: "Cost Alerts & Trends", req: "AD-01 → AD-05" },
      { to: "/admin/vendors", label: "Vendor Insights", req: "AD-10 → AD-14" },
      { to: "/admin/collections", label: "Collections", req: "AD-20 → AD-24" },
      { to: "/admin/income", label: "Income Optimisation", req: "AD-30 → AD-33" },
    ],
  },
  {
    label: "Admin · Controls",
    tone: "admin" as const,
    group: "controls" as const,
    items: [
      { to: "/admin/transactions", label: "Transactions (CRUD)", req: "AC-01 → AC-05" },
      { to: "/admin/residents", label: "Residents & Whitelist", req: "AC-10 → AC-13" },
      { to: "/admin/settings", label: "Dashboard Controls", req: "AC-30 → AC-32" },
      { to: "/admin/audit", label: "Audit Trail", req: "AC-40 → AC-41" },
      { to: "/admin/imports", label: "CSV Imports", req: "AC-50 → AC-52" },
      { to: "/admin/etl", label: "ETL Integration", req: "AC-53 → AC-55" },
    ],
  },
];

// ============ Admin-control mock data ============

export type TxnRow = {
  id: string;
  date: string;            // YYYY-MM-DD
  month: string;           // display month
  head: "expense" | "income";
  category: string;
  vendor?: string;
  lineItem: string;
  flat?: string;
  amount: number;
  direction: "C" | "D";
  notes?: string;
  source: "manual" | "csv" | "auto";
};

const seedTxns: TxnRow[] = [];
let tid = 1000;
expenseTree.forEach((c) => c.vendors.forEach((v) => v.items.forEach((it) => {
  it.monthly.forEach((amt, mi) => {
    if (amt <= 0) return;
    seedTxns.push({
      id: `T${tid++}`,
      date: `2026-${String(((mi + 8 - 1) % 12) + 1).padStart(2, "0")}-05`,
      month: months12[mi],
      head: "expense",
      category: c.name,
      vendor: v.name,
      lineItem: it.name,
      amount: amt,
      direction: "D",
      source: mi % 3 === 0 ? "csv" : "manual",
    });
  });
})));
incomeTree.forEach((c) => c.vendors.forEach((v) => v.items.forEach((it) => {
  it.monthly.forEach((amt, mi) => {
    if (amt <= 0) return;
    seedTxns.push({
      id: `T${tid++}`,
      date: `2026-${String(((mi + 8 - 1) % 12) + 1).padStart(2, "0")}-10`,
      month: months12[mi],
      head: "income",
      category: c.name,
      vendor: v.name,
      lineItem: it.name,
      amount: amt,
      direction: "C",
      source: "manual",
    });
  });
})));
export const seedTransactions = seedTxns;

export type ResidentRow = {
  id: string;
  email: string;
  name: string;
  flat: string;
  role: "resident" | "admin";
  status: "active" | "invited" | "revoked";
  invitedAt: string;
};

export const seedResidents: ResidentRow[] = [
  { id: "R1", email: "priya.sharma@example.com",  name: "Priya Sharma",     flat: "A-101", role: "resident", status: "active",  invitedAt: "2026-01-12" },
  { id: "R2", email: "arjun.rao@example.com",     name: "Arjun Rao",        flat: "A-102", role: "resident", status: "active",  invitedAt: "2026-01-12" },
  { id: "R3", email: "meera.iyer@example.com",    name: "Meera Iyer",       flat: "B-204", role: "resident", status: "active",  invitedAt: "2026-02-01" },
  { id: "R4", email: "kiran.desai@example.com",   name: "Kiran Desai",      flat: "B-207", role: "resident", status: "invited", invitedAt: "2026-06-18" },
  { id: "R5", email: "rahul.mehta@example.com",   name: "Rahul Mehta",      flat: "C-301", role: "admin",    status: "active",  invitedAt: "2025-11-04" },
  { id: "R6", email: "anita.kulkarni@example.com",name: "Anita Kulkarni",   flat: "C-305", role: "admin",    status: "active",  invitedAt: "2025-11-04" },
  { id: "R7", email: "vivek.nair@example.com",    name: "Vivek Nair",       flat: "D-402", role: "resident", status: "revoked", invitedAt: "2025-09-22" },
];

// (Vendor master CRUD removed — vendors are surfaced only via expense insights.)

export type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  entity: string;
  entityId?: string;
  action: "create" | "update" | "delete" | "login" | "import" | "settings";
  summary: string;
  ip?: string;
};

export const seedAuditLog: AuditEntry[] = [
  { id: 1,  at: "2026-07-13 09:12", actor: "rahul.mehta@example.com",   entity: "session",            action: "login",    summary: "OTP login",                       ip: "49.207.x.x" },
  { id: 2,  at: "2026-07-13 09:14", actor: "rahul.mehta@example.com",   entity: "dashboard_settings", action: "settings", summary: "Hidden 'resident.balance' widget cashRunway" },
  { id: 3,  at: "2026-07-13 09:20", actor: "anita.kulkarni@example.com",entity: "transaction",        entityId: "T1032", action: "update",   summary: "Edited Utilities · Bescom · ₹52,000 → ₹48,500" },
  { id: 4,  at: "2026-07-13 10:02", actor: "rahul.mehta@example.com",   entity: "resident",           entityId: "R4",    action: "create",   summary: "Invited kiran.desai@example.com (B-207)" },
  { id: 5,  at: "2026-07-13 10:45", actor: "system",                    entity: "import_batch",       entityId: "IMP-91",action: "import",   summary: "CSV import — 214 rows staged, 208 committed" },
  { id: 6,  at: "2026-07-12 18:04", actor: "anita.kulkarni@example.com",entity: "transaction",        entityId: "T1044", action: "delete",   summary: "Deleted duplicate Housekeeping txn" },
  
  { id: 8,  at: "2026-07-11 08:32", actor: "priya.sharma@example.com",  entity: "session",            action: "login",    summary: "OTP login",                       ip: "182.68.x.x" },
  { id: 9,  at: "2026-07-10 14:22", actor: "rahul.mehta@example.com",   entity: "resident",           entityId: "R7",    action: "delete",   summary: "Revoked vivek.nair@example.com" },
  { id: 10, at: "2026-07-09 11:03", actor: "system",                    entity: "import_batch",       entityId: "IMP-90",action: "import",   summary: "Vendors CSV — 12 rows committed" },
];

export type DashboardControl = {
  key: string;
  label: string;
  persona: "resident" | "admin";
  enabled: boolean;
  hiddenWidgets: string[];
  widgets: { id: string; label: string }[];
};

export const seedDashboardControls: DashboardControl[] = [
  { key: "resident.overview",  label: "Resident · Overview",         persona: "resident", enabled: true,  hiddenWidgets: [],
    widgets: [
      { id: "kpi.collections", label: "Collections KPI" },
      { id: "kpi.expenses",    label: "Expenses KPI" },
      { id: "kpi.net",         label: "Net position KPI" },
      { id: "chart.trend",     label: "12-month trend" },
      { id: "list.topCats",    label: "Top expense categories" },
    ]},
  { key: "resident.drilldown", label: "Resident · Head Drill-down",  persona: "resident", enabled: true,  hiddenWidgets: [],
    widgets: [
      { id: "tree.hierarchy",  label: "Category → Vendor tree" },
      { id: "chart.category",  label: "Category chart" },
    ]},
  { key: "resident.cashflow",  label: "Resident · Cashflow Health",  persona: "resident", enabled: true,  hiddenWidgets: ["runway"],
    widgets: [
      { id: "chart.cashflow",  label: "Inflow vs outflow" },
      { id: "runway",          label: "Cash runway (months)" },
    ]},
  { key: "resident.income",    label: "Resident · Income Visibility",persona: "resident", enabled: true,  hiddenWidgets: [],
    widgets: [
      { id: "chart.mix",       label: "Income mix pie" },
      { id: "table.sources",   label: "Sources breakdown" },
    ]},
  { key: "resident.balance",   label: "Resident · Opening & Closing",persona: "resident", enabled: false, hiddenWidgets: [],
    widgets: [
      { id: "strip.balance",   label: "Opening/Closing strip" },
      { id: "chart.rolling",   label: "Rolling balance chart" },
    ]},
];

export type ImportBatch = {
  id: string;
  filename: string;
  kind: "transactions" | "residents" | "vendors";
  uploadedBy: string;
  uploadedAt: string;
  rows: number;
  committed: number;
  status: "staged" | "committed" | "failed" | "partial";
};

export const seedImports: ImportBatch[] = [
  { id: "IMP-91", filename: "tally-export-jul26.csv", kind: "transactions", uploadedBy: "rahul.mehta@example.com",   uploadedAt: "2026-07-13 10:45", rows: 214, committed: 208, status: "partial"   },
  { id: "IMP-90", filename: "vendors-master.csv",     kind: "vendors",      uploadedBy: "system",                     uploadedAt: "2026-07-09 11:03", rows:  12, committed:  12, status: "committed" },
  { id: "IMP-89", filename: "residents-2026.csv",     kind: "residents",    uploadedBy: "rahul.mehta@example.com",   uploadedAt: "2026-06-30 17:20", rows:  84, committed:  84, status: "committed" },
  { id: "IMP-88", filename: "collections-may26.xlsx.csv", kind: "transactions", uploadedBy: "anita.kulkarni@example.com", uploadedAt: "2026-06-05 09:12", rows: 128, committed: 0,   status: "failed"    },
];
