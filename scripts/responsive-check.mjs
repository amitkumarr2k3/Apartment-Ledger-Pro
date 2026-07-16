#!/usr/bin/env node
/**
 * Responsive regression check for the PortalShell.
 *
 * Screenshots every prototype route at a matrix of widths so header
 * overlap / clipping regressions are caught visually.
 *
 * Usage:
 *   bun scripts/responsive-check.mjs                 # against http://localhost:8090
 *
 * Override with BASE_URL env var, e.g.:
 *   BASE_URL=https://staging.example.com bun scripts/responsive-check.mjs
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8090";
const OUT = "/tmp/responsive-check";

// Common breakpoints + the awkward in-between widths where headers
// historically broke (persona pill vs section pill, etc.).
const WIDTHS = [320, 360, 390, 480, 640, 768, 900, 1024, 1280, 1440];

const ROUTES = [
  "/",
  "/resident/overview",
  "/resident/drilldown",
  "/resident/cashflow",
  "/resident/income",
  "/resident/balance",
  "/admin/actions",
  "/admin/alerts",
  "/admin/vendors",
  "/admin/collections",
  "/admin/income",
];

const results = [];

const browser = await chromium.launch();
try {
  for (const width of WIDTHS) {
    await mkdir(join(OUT, String(width)), { recursive: true });
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      const url = `${BASE_URL}${route}`;
      await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
      const slug = route === "/" ? "index" : route.replace(/^\//, "").replace(/\//g, "_");
      const file = join(OUT, String(width), `${slug}.png`);
      await page.screenshot({ path: file });

      // Header sanity: no horizontal overflow, no clipped text.
      const header = await page.evaluate(() => {
        const h = document.querySelector("header");
        if (!h) return null;
        const overflowX = h.scrollWidth - h.clientWidth;
        const clipped = Array.from(h.querySelectorAll("*")).some((el) => {
          if (!(el instanceof HTMLElement)) return false;
          const s = getComputedStyle(el);
          return s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
        });
        return { overflowX, clipped };
      });
      const bodyOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      results.push({
        width,
        route,
        headerOverflowPx: header?.overflowX ?? null,
        headerHasClippedText: header?.clipped ?? null,
        bodyOverflowPx: bodyOverflow,
        screenshot: file,
        ok: (header?.overflowX ?? 0) <= 0 && bodyOverflow <= 0,
      });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

await writeFile(join(OUT, "checks.json"), JSON.stringify(results, null, 2));

const failed = results.filter((r) => !r.ok);
console.log(`Ran ${results.length} checks across ${WIDTHS.length} widths.`);
if (failed.length) {
  console.log(`\nFAIL (${failed.length}):`);
  for (const f of failed) {
    console.log(
      `  ${f.width}px ${f.route}  header+${f.headerOverflowPx}px  body+${f.bodyOverflowPx}px  ${f.screenshot}`,
    );
  }
  process.exit(1);
}
console.log("All widths clean — no header/body overflow detected.");
