import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProcurementInfo, procurementCategory } from "./procurement-info";

function render(name: string, persona: "resident" | "admin" | "superadmin" = "resident") {
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ProcurementInfo, { name, persona })));
}

describe("ProcurementInfo", () => {
  it("renders an accessible info button only for the procurement category", () => {
    expect(render("Utilities")).toBe("");
    expect(render(procurementCategory)).toContain(`aria-label="About ${procurementCategory}"`);
    expect(render(procurementCategory)).toContain('type="button"');
  });

  it("matches imported category casing and surrounding whitespace for all personas", () => {
    for (const persona of ["resident", "admin", "superadmin"] as const) {
      expect(render(` ${procurementCategory.toUpperCase()} `, persona)).toContain("About ONE TIME OPERATIONAL PROCUREMENT");
    }
  });
});