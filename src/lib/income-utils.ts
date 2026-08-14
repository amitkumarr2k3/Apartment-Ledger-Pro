const normalize = (value: string) => value.trim().toLowerCase();

export const isMaintenanceOutstandingCategory = (name: string) =>
  normalize(name) === "maintenance outstanding";

// Reference/rate-card rows (e.g. "Maintenance Rate Reference",
// "Contingency Rate Reference") exist purely so the frontend can compute
// Expected Collection / Contingency Fund from a per-sqft rate. They are
// NEVER real money and must never be treated as a reportable income
// category anywhere in the app -- without this exclusion they leak into
// "Income sources" style breakdowns as phantom line items (e.g. a
// "Contingency Rate Reference" row showing up next to real income sources).
export const isRateReferenceCategory = (name: string) =>
  /rate reference/i.test(name || "");

// Statutory tax collections (CGST/SGST, "Tax Collected (Liability)") are
// money the society holds on behalf of the government -- they are a
// liability, not income the society can use, and must never appear in an
// "Income Categories" / "Income sources" list. The GST Liability card on
// Overview is the correct place to surface this figure.
export const isTaxCategory = (name: string) =>
  /tax|gst|cgst|sgst/i.test(name || "");

export const isReportableIncomeCategory = (name: string) =>
  !isMaintenanceOutstandingCategory(name) && !isRateReferenceCategory(name) && !isTaxCategory(name);

export const filterReportableIncomeCategories = <T extends { name: string }>(items: T[]) =>
  items.filter((item) => isReportableIncomeCategory(item.name));
