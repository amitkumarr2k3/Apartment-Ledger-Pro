import { describe, expect, it } from "vitest";
import { formatVendorNames } from "./drilldown-vendor-text";

describe("formatVendorNames", () => {
  it("unwraps grouped vendors and removes the placeholder label", () => {
    expect(
      formatVendorNames([
        "Act Internet",
        "Airtel Postpaid",
        "Multiple Vendors (Sai Krupa Petroleum / Sai Abhay Petroleum / EXOZEN)",
      ]).names,
    ).toEqual([
      "Act Internet",
      "Airtel Postpaid",
      "Sai Krupa Petroleum / Sai Abhay Petroleum / EXOZEN",
    ]);
  });

  it("drops a bare Multiple Vendors entry while retaining grouped names", () => {
    expect(
      formatVendorNames([
        "Multiple Vendors",
        "Multiple Vendors (Kavitha Enterprises / Sashi Kumar K)",
      ]).names,
    ).toEqual(["Kavitha Enterprises / Sashi Kumar K"]);
  });
});
