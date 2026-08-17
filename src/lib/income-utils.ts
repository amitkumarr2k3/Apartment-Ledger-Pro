const normalize = (value: string) => value.trim().toLowerCase();

export const isMaintenanceOutstandingCategory = (name: string) =>
  normalize(name) === "maintenance outstanding";

// FIX (2026-08-15): aligning with the broader liability exclusion already
// in use on resident.overview.tsx / resident.cashflow.tsx (isLiability).
// The exact-match check above only caught a category literally named
// "Maintenance Outstanding" -- it would miss any other liability-style
// category (e.g. containing "arrears" or "default") that isn't real,
// collectible income. This is the single source of truth now; both admin
// and resident screens that import filterReportableIncomeCategories pick
// up this widened rule automatically.
export const isLiabilityCategory = (name: string) =>
  /outstanding|arrears|default/i.test(name || "");

// Reference/rate-card rows (e.g. "Maintenance Rate Reference",
// "Contingency Rate Reference", "Expected Collection Reference") exist
// purely so the frontend can read planning/target figures uploaded via CSV
// (per-sqft rates, contingency portions, or -- as of the Expected
// Collection CSV migration -- the collection target amount itself,
// supplied directly instead of computed from rate x area). They are NEVER
// real money and must never be treated as a reportable income category
// anywhere in the app -- without this exclusion they leak into "Income
// sources" style breakdowns as phantom line items.
//
// FIX (Expected Collection CSV migration): widened from matching the
// specific substring "rate reference" to matching by SUFFIX ("...Reference")
// so "Expected Collection Reference" -- which doesn't contain "rate" -- is
// also covered, along with any future reference-style category, without
// needing another change here.
export const isRateReferenceCategory = (name: string) =>
  /reference$/i.test((name || "").trim());

// Statutory tax collections (CGST/SGST, "Tax Collected (Liability)") are
// money the society holds on behalf of the government -- they are a
// liability, not income the society can use, and must never appear in an
// "Income Categories" / "Income sources" list. The GST Liability card on
// Overview is the correct place to surface this figure.
export const isTaxCategory = (name: string) =>
  /tax|gst|cgst|sgst/i.test(name || "");

export const isReportableIncomeCategory = (name: string) =>
  !isLiabilityCategory(name) && !isRateReferenceCategory(name) && !isTaxCategory(name);

export const filterReportableIncomeCategories = <T extends { name: string }>(items: T[]) =>
  items.filter((item) => isReportableIncomeCategory(item.name));

// Exact-name match for the single "Maintenance Charge" line item -- must
// NEVER pick up Association Fund, AV Room, Late Payment Fine, Lift
// Advertisement, Move In/Out Charges, CGST/SGST, or anything else that
// merely contains the word "maintenance". Mirrors resident.overview.tsx's
// isMaintenanceChargeExact so every screen reporting "Collected
// Maintenance" / "Collection" agrees on the same figure.
export const isMaintenanceChargeLineItem = (name: string) =>
  normalize(name) === "maintenance charge";

type IncomeTreeLike = {
  name: string;
  vendors?: { name: string; items?: { name: string; monthly?: number[] }[] }[];
}[];

// Sums ONLY the exact "Maintenance Charge" line item, per month, regardless
// of which category/vendor it happens to be nested under. Returns an array
// aligned index-for-index with months12 (same convention as sumMonthly()).
// Use this instead of a backend "collection" aggregate wherever a chart's
// "Collection" is meant to represent maintenance dues specifically (e.g.
// compared against a per-sqft "Expected Collection" target) -- a raw
// backend collection total includes GST/tax, rate-reference rows, and
// every other income category, which over-counts this figure.
export const sumMaintenanceChargeMonthly = (tree: IncomeTreeLike, monthCount: number): number[] => {
  const out = new Array(monthCount).fill(0);
  tree.forEach((c) => {
    const catHit = isMaintenanceChargeLineItem(c.name);
    (c.vendors || []).forEach((v) => {
      const vHit = isMaintenanceChargeLineItem(v.name);
      (v.items || []).forEach((it) => {
        if (catHit || vHit || isMaintenanceChargeLineItem(it.name)) {
          (it.monthly || []).forEach((val, i) => {
            if (i < out.length) out[i] += val || 0;
          });
        }
      });
    });
  });
  return out;
};
