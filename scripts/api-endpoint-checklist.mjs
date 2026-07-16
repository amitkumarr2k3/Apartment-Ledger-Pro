#!/usr/bin/env node
/**
 * API endpoint checklist.
 *
 * For each prototype screen, asserts that the required API endpoints exist
 * and return the expected top-level shape. Uses a JWT if APF_TOKEN is set;
 * otherwise skips authed endpoints and reports them as "auth-required".
 *
 * Usage:
 *   APF_API=http://localhost:4010 APF_TOKEN=... node scripts/api-endpoint-checklist.mjs
 */
const API = process.env.APF_API ?? "http://localhost:4010";
const TOKEN = process.env.APF_TOKEN ?? "";

const CHECKS = [
  // { screen, path, method, authed, expect: (json) => string | null }
  { screen: "resident.overview",  path: "/api/dashboard/monthly-totals", authed: true,
    expect: (j) => Array.isArray(j) && (j.length === 0 || "collection_paise" in j[0]) ? null : "expected array of {month, collection_paise, expense_paise, net_paise}" },
  { screen: "resident.overview",  path: "/api/dashboard/balance-strip",  authed: true,
    expect: (j) => j && "opening" in j && "closing" in j ? null : "expected {opening, income, expense, net, closing}" },
  { screen: "resident.income",    path: "/api/income/category-totals",   authed: true,
    expect: (j) => Array.isArray(j) ? null : "expected array of {name, total}" },
  { screen: "resident.drilldown", path: "/api/expenses/tree",            authed: true,
    expect: (j) => Array.isArray(j) ? null : "expected array of {category, vendor, line_item, month, amount}" },
  { screen: "admin.income",       path: "/api/income/tree",              authed: true,
    expect: (j) => Array.isArray(j) ? null : "expected array of {category, vendor, line_item, month, amount}" },
  { screen: "admin.alerts",       path: "/api/expenses/anomalies",       authed: true,
    expect: (j) => Array.isArray(j) ? null : "expected array of {category, cur, avg, ratio}" },
  { screen: "admin.vendors",      path: "/api/vendors/ranking",          authed: true,
    expect: (j) => Array.isArray(j) ? null : "expected array" },
  { screen: "admin.transactions", path: "/api/admin/transactions?pageSize=1", authed: true,
    expect: (j) => j && Array.isArray(j.rows) && "total" in j ? null : "expected {rows, total, page, pageSize}" },
  { screen: "admin.audit",        path: "/api/admin/audit?pageSize=1",   authed: true,
    expect: (j) => j && Array.isArray(j.rows ?? j) ? null : "expected {rows, ...} or array" },
  { screen: "admin.settings",     path: "/api/admin/settings/dashboards", authed: true,
    expect: (j) => Array.isArray(j) ? null : "expected array of dashboard settings" },
  { screen: "system",             path: "/health",  authed: false, expect: (j) => j?.ok ? null : "not ok" },
  { screen: "system",             path: "/ready",   authed: false, expect: (j) => j?.ok ? null : "not ready" },
];

const clr = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };

async function run() {
  console.log(`API checklist → ${API}${TOKEN ? "  (with token)" : "  (no token)"}\n`);
  let pass = 0, fail = 0, skip = 0;
  const bySection = new Map();
  for (const c of CHECKS) {
    if (c.authed && !TOKEN) {
      skip++;
      logRow(bySection, c.screen, `${clr.y}SKIP${clr.x}  ${c.path}  ${clr.d}(needs APF_TOKEN)${clr.x}`);
      continue;
    }
    try {
      const res = await fetch(`${API}${c.path}`, {
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      });
      if (!res.ok) {
        fail++;
        logRow(bySection, c.screen, `${clr.r}FAIL${clr.x}  ${c.path}  ${clr.d}HTTP ${res.status}${clr.x}`);
        continue;
      }
      const json = await res.json();
      const err = c.expect(json);
      if (err) {
        fail++;
        logRow(bySection, c.screen, `${clr.r}FAIL${clr.x}  ${c.path}  ${clr.d}${err}${clr.x}`);
      } else {
        pass++;
        logRow(bySection, c.screen, `${clr.g}PASS${clr.x}  ${c.path}`);
      }
    } catch (e) {
      fail++;
      logRow(bySection, c.screen, `${clr.r}FAIL${clr.x}  ${c.path}  ${clr.d}${e.message}${clr.x}`);
    }
  }

  for (const [screen, lines] of bySection) {
    console.log(`\n${clr.d}[${screen}]${clr.x}`);
    for (const l of lines) console.log("  " + l);
  }
  console.log(`\n${clr.g}${pass} pass${clr.x} · ${clr.r}${fail} fail${clr.x} · ${clr.y}${skip} skip${clr.x}`);
  process.exit(fail > 0 ? 1 : 0);
}

function logRow(map, screen, line) {
  if (!map.has(screen)) map.set(screen, []);
  map.get(screen).push(line);
}

run().catch((e) => { console.error(e); process.exit(2); });
