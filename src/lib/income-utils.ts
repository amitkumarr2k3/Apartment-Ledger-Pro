const normalize = (value: string) => value.trim().toLowerCase();

export const isMaintenanceOutstandingCategory = (name: string) =>
  normalize(name) === "maintenance outstanding";

export const isReportableIncomeCategory = (name: string) =>
  !isMaintenanceOutstandingCategory(name);

export const filterReportableIncomeCategories = <T extends { name: string }>(items: T[]) =>
  items.filter((item) => isReportableIncomeCategory(item.name));