import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DrilldownLineItemSummary,
  categoryLineItemDisplayNames,
  categoryLineItemNames,
} from "./drilldown-line-item-summary";
import type { Category } from "@/lib/finance-mock";

function category(names: string[]): Category {
  return {
    name: "Facility Management",
    vendors: [
      {
        name: "Vendor",
        kind: "company",
        items: names.map((name) => ({ name, monthly: [100] })),
      },
    ],
  };
}

describe("DrilldownLineItemSummary", () => {
  it("deduplicates and sorts line-item names across vendors", () => {
    const data: Category = {
      name: "Utilities",
      vendors: [
        {
          name: "A",
          kind: "company",
          items: [
            { name: "Internet", monthly: [] },
            { name: "Diesel", monthly: [] },
          ],
        },
        { name: "B", kind: "company", items: [{ name: "Internet", monthly: [] }] },
      ],
    };
    expect(categoryLineItemNames(data)).toEqual(["Diesel", "Internet"]);
  });

  it("detects and groups any repeated line-item prefix without configuration", () => {
    const data = category([
      "Arbitrary Group - First",
      "Arbitrary Group - Second",
      "Petty Cash - Consumables",
      "Petty Cash - Electricals",
      "Tools & Stationary",
    ]);

    expect(categoryLineItemDisplayNames(data)).toEqual([
      "Arbitrary Group - First, Second",
      "Petty Cash - Consumables, Electricals",
      "Tools & Stationary",
    ]);
  });

  it("automatically includes newly added suffixes for an existing repeated prefix", () => {
    const data = category([
      "Petty Cash - Consumables",
      "Petty Cash - Future New Item",
      "Petty Cash - Electricals",
    ]);

    expect(categoryLineItemDisplayNames(data)).toEqual([
      "Petty Cash - Consumables, Electricals, Future New Item",
    ]);
  });

  it("uses singular wording for one line item", () => {
    const html = renderToStaticMarkup(
      createElement(DrilldownLineItemSummary, { category: category(["Only Item"]) }),
    );
    expect(html).toContain("Sum of Only Item per month");
    expect(html).not.toContain("Sum of all");
  });

  it("shows a compact preview and exposes the full list for long categories", () => {
    const html = renderToStaticMarkup(
      createElement(DrilldownLineItemSummary, {
        category: category(["A", "B", "C", "D", "E", "F"]),
      }),
    );
    expect(html).toContain("Sum of all A, B, C, D");
    expect(html).toContain("+2 more");
    expect(html).toContain("per month, for the selected range");
    expect(html).not.toContain("Line items:");
  });
});
