import { describe, expect, it } from "vitest";
import {
  filterReportableIncomeCategories,
  isMaintenanceChargeLineItem,
  sumMaintenanceChargeMonthly,
} from "./income-utils";

describe("reportable income categories", () => {
  it("excludes liabilities, taxes and reference rows", () => {
    const names = [
      "Maintenance Collections",
      "Commercial Income",
      "Maintenance Outstanding",
      "Previous Arrears",
      "CGST Collected",
      "Tax Collected (Liability)",
      "Maintenance Rate Reference",
      "Expected Collection Reference",
    ].map((name) => ({ name }));

    expect(filterReportableIncomeCategories(names).map((c) => c.name)).toEqual([
      "Maintenance Collections",
      "Commercial Income",
    ]);
  });
});

describe("maintenance charge totals", () => {
  it("matches only the exact Maintenance Charge line item", () => {
    expect(isMaintenanceChargeLineItem(" Maintenance Charge ")).toBe(true);
    expect(isMaintenanceChargeLineItem("Maintenance Charge Late Fee")).toBe(false);
  });

  it("sums monthly values across categories and ignores other line items", () => {
    const tree = [
      {
        name: "Maintenance Collections",
        vendors: [{ name: "Residents", items: [
          { name: "Maintenance Charge", monthly: [100, 200, 300] },
          { name: "Late Payment Fine", monthly: [5, 5, 5] },
        ] }],
      },
      {
        name: "Other Block",
        vendors: [{ name: "Residents", items: [{ name: "maintenance charge", monthly: [10, 20] }] }],
      },
    ];

    expect(sumMaintenanceChargeMonthly(tree, 3)).toEqual([110, 220, 300]);
  });
});
