#!/usr/bin/env node
/**
 * Generates sample CSV files that mirror the exact dummy data used by the
 * frontend (`src/lib/finance-mock.ts`). Output goes to docs/samples/.
 *
 * The generated files can be uploaded verbatim through the UI's
 * "CSV Import" section (Admin → Controls → CSV Imports), or seeded into
 * Postgres via `scripts/csv-import.sh`.
 *
 * Run:  node scripts/generate-sample-csvs.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "samples");
mkdirSync(OUT, { recursive: true });

// -------- Mirror of finance-mock.ts data generators ------------------------
const MONTHS = [
  "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
  "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
];
const fill = (base, jitter, sparse = []) =>
  MONTHS.map((_, i) =>
    sparse.includes(i) ? 0 : Math.max(0, Math.round(base + Math.sin(i) * jitter)),
  );

const EXPENSES = [
  { cat: "Utilities", vendor: "Bescom", kind: "company", items: [
    { name: "Common area electricity", monthly: fill(48000, 4000) },
    { name: "Backup usage", monthly: fill(12000, 3500, [2, 8]) },
  ]},
  { cat: "Utilities", vendor: "BWSSB", kind: "company", items: [
    { name: "Water charges", monthly: fill(32000, 2000) },
  ]},
  { cat: "Maintenance", vendor: "ABC Enterprise", kind: "company", items: [
    { name: "Labour charges", monthly: fill(65000, 3000) },
    { name: "Spare parts", monthly: fill(18000, 6000, [1, 4, 7]) },
    { name: "STP salt purchase", monthly: fill(9000, 500, [0, 1, 3, 4, 6, 7, 9, 10]) },
  ]},
  { cat: "Maintenance", vendor: "John (Plumber)", kind: "individual", items: [
    { name: "Plumbing repair", monthly: fill(4500, 3500, [0, 2, 5, 6, 8, 11]) },
  ]},
  { cat: "Security", vendor: "SafeGuard Services", kind: "company", items: [
    { name: "Guard salaries", monthly: fill(120000, 2000) },
  ]},
  { cat: "Housekeeping", vendor: "CleanCo", kind: "company", items: [
    { name: "Staff wages", monthly: fill(58000, 1500) },
    { name: "Cleaning supplies", monthly: fill(7500, 1500) },
  ]},
  { cat: "Petty Cash", vendor: "Office petty cash", kind: "individual", items: [
    { name: "Ad-hoc expenses", monthly: fill(6000, 5500) },
  ]},
];

const INCOMES = [
  { cat: "Maintenance Collections", vendor: "Monthly maintenance", kind: "company", items: [
    { name: "Flat maintenance dues", monthly: fill(340000, 15000) },
  ]},
  { cat: "Other Income", vendor: "Community Hall", kind: "company", items: [
    { name: "Hall rental", monthly: fill(18000, 8000, [1, 5, 9]) },
    { name: "Event usage charges", monthly: fill(6000, 4500, [0, 2, 4, 6, 8, 10]) },
  ]},
  { cat: "Other Income", vendor: "Signage Rental", kind: "individual", items: [
    { name: "Billboard fee", monthly: fill(12000, 500) },
  ]},
];

// -------- CSV emitters -----------------------------------------------------
const esc = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows, header) =>
  [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n") + "\n";

// 1) transactions.csv — the primary import for the "CSV Import" screen.
//    Columns match backend/src/routes/admin.imports.ts → commitTransactionRow().
const txnRows = [];
const pushTree = (groups, direction) => {
  for (const g of groups) {
    for (const item of g.items) {
      for (let mi = 0; mi < MONTHS.length; mi++) {
        const amt = item.monthly[mi];
        if (!amt) continue; // sparse months intentionally absent
        const date = `${MONTHS[mi]}-15`;
        txnRows.push({
          date,
          head: direction === "D" ? "expense" : "income",
          category: g.cat,
          vendor: g.vendor,
          vendor_kind: g.kind,
          line_item: item.name,
          amount: amt,
          direction,
          flat_code: "",
          source_ref: `${direction}|${g.cat}|${g.vendor}|${item.name}|${MONTHS[mi]}`,
        });
      }
    }
  }
};
pushTree(EXPENSES, "D");
pushTree(INCOMES, "C");
writeFileSync(
  join(OUT, "transactions.csv"),
  toCsv(txnRows, [
    "date","head","category","vendor","vendor_kind","line_item",
    "amount","direction","flat_code","source_ref",
  ]),
);

// 2) vendors.csv — small, deduped from the trees.
const vendorSet = new Map();
for (const g of [...EXPENSES, ...INCOMES]) {
  if (!vendorSet.has(g.vendor)) vendorSet.set(g.vendor, g.kind);
}
writeFileSync(
  join(OUT, "vendors.csv"),
  toCsv(
    [...vendorSet].map(([name, kind]) => ({ name, kind })),
    ["name", "kind"],
  ),
);

// 3) residents.csv — 24 flats (A-001..A-024), a couple named entries first
//    so the whitelist has real-looking names.
const namedResidents = [
  { email: "alice@example.com",  name: "Alice Sharma",   flat_code: "A-001" },
  { email: "bob@example.com",    name: "Bob Iyer",       flat_code: "A-002" },
  { email: "carol@example.com",  name: "Carol Menon",    flat_code: "A-003" },
  { email: "dev@example.com",    name: "Dev Kapoor",     flat_code: "A-004" },
  { email: "esha@example.com",   name: "Esha Rao",       flat_code: "A-005" },
];
const residents = [
  ...namedResidents,
  ...Array.from({ length: 24 - namedResidents.length }, (_, i) => {
    const n = i + namedResidents.length + 1;
    const flat = `A-${String(n).padStart(3, "0")}`;
    return { email: `resident${n}@example.com`, name: `Resident ${n}`, flat_code: flat };
  }),
];
writeFileSync(
  join(OUT, "residents.csv"),
  toCsv(residents, ["email", "name", "flat_code"]),
);

console.log(`Wrote CSVs to ${OUT}`);
console.log(`  transactions.csv  (${txnRows.length} rows)`);
console.log(`  vendors.csv       (${vendorSet.size} rows)`);
console.log(`  residents.csv     (${residents.length} rows)`);
