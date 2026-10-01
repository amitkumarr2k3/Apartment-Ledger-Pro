import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { navSections } from "@/lib/finance-mock";

// Source-level contract: catches a widget or dashboard that is added/renamed in one place but not the others.
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(root + path, "utf8");

const adminSettings = read("src/routes/admin.settings.tsx");
const backendSettings = read("backend/src/routes/admin.settings.ts");

const dashboardBlocks = adminSettings
  .split(/(?=key: "resident\.)/)
  .slice(1)
  .map((block) => ({
    key: block.match(/key: "(resident\.[a-z]+)"/)![1],
    widgets: [...block.matchAll(/id: "([a-zA-Z]+\.[a-zA-Z0-9]+)"/g)].map((m) => m[1]),
  }));

const residentNavKeys = navSections
  .filter((section) => section.tone === "resident")
  .flatMap((section) => section.items)
  .map((item) => item.to.slice(1).replace("/", "."));

describe("dashboard controls contract", () => {
  it("has one admin control per resident navigation page", () => {
    expect(dashboardBlocks.map((d) => d.key).sort()).toEqual([...residentNavKeys].sort());
  });

  it("only offers dashboard keys the backend accepts", () => {
    const backendKeys = [...backendSettings.matchAll(/"(resident\.[a-z]+)"/g)].map((m) => m[1]);
    for (const { key } of dashboardBlocks) expect(backendKeys).toContain(key);
  });

  for (const { key, widgets } of dashboardBlocks) {
    const page = read(`src/routes/${key}.tsx`);
    const gatedWidgets = [...page.matchAll(/isWidgetVisible\("([^"]+)"\)/g)].map((m) => m[1]);

    it(`${key}: every admin widget switch is wired to the page`, () => {
      for (const widget of widgets) expect(gatedWidgets, `${widget} is not gated in ${key}.tsx`).toContain(widget);
    });

    it(`${key}: every gated widget can be controlled by an admin`, () => {
      for (const widget of new Set(gatedWidgets)) expect(widgets, `${widget} has no admin switch`).toContain(widget);
    });

    if (widgets.length > 0) {
      it(`${key}: reads its own dashboard settings`, () => {
        expect(page).toContain(`useWidgetVisibility("${key}")`);
      });
    }
  }
});
