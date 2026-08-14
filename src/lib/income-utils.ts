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

export const isReportableIncomeCategory = (name: string) =>
  !isMaintenanceOutstandingCategory(name) && !isRateReferenceCategory(name);

export const filterReportableIncomeCategories = <T extends { name: string }>(items: T[]) =>
  items.filter((item) => isReportableIncomeCategory(item.name));
