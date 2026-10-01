import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// In-memory stand-in for Postgres so route, auth and RBAC wiring run without a database.
const db = vi.hoisted(() => {
  const query = vi.fn();
  const txQuery = vi.fn();
  return {
    query,
    txQuery,
    withTx: vi.fn(async (fn: (c: { query: typeof txQuery }) => unknown) => fn({ query: txQuery })),
  };
});

vi.mock("../src/db", () => ({
  pool: { query: db.query, connect: vi.fn() },
  withTx: db.withTx,
  refreshRollups: vi.fn(),
}));

process.env.JWT_SECRET = "test-secret-for-vitest-only";
process.env.AUTH_ENABLED = "true";
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "test";

const COMMUNITY = "11111111-1111-1111-1111-111111111111";
let app: FastifyInstance;

function cookieFor(roles: string[]) {
  const token = app.jwt.sign({ sub: "user-1", email: `${roles[0] ?? "resident"}@example.com`, roles, cid: COMMUNITY });
  return { cookie: `apf_token=${token}` };
}

const resident = () => cookieFor(["resident"]);
const admin = () => cookieFor(["admin"]);
const superadmin = () => cookieFor(["superadmin", "admin"]);

beforeAll(async () => {
  const { buildApp } = await import("../src/server");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  db.query.mockReset();
  db.txQuery.mockReset();
  db.withTx.mockClear();
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.txQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("health", () => {
  it("reports live without touching the database", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, status: "live" });
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("authentication", () => {
  const protectedRoutes = [
    "/api/dashboard/monthly-totals",
    "/api/dashboard/balance-strip",
    "/api/income/tree",
    "/api/expenses/tree",
    "/api/vendors/ranking",
    "/api/admin/settings/dashboards",
  ];

  for (const url of protectedRoutes) {
    it(`rejects anonymous ${url}`, async () => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
      expect(db.query).not.toHaveBeenCalled();
    });
  }

  it("rejects a token signed with another secret", async () => {
    const forged = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZXMiOlsic3VwZXJhZG1pbiJdfQ.invalid";
    const res = await app.inject({ method: "GET", url: "/api/dashboard/monthly-totals", headers: { cookie: `apf_token=${forged}` } });
    expect(res.statusCode).toBe(401);
  });
});

describe("dashboard data", () => {
  it("scopes monthly totals to the caller's community", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ month: "2026-04-01", collection_paise: "100", expense_paise: "50", net_paise: "50" }] });
    const res = await app.inject({ method: "GET", url: "/api/dashboard/monthly-totals", headers: resident() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(db.query.mock.calls[0][1][0]).toBe(COMMUNITY);
  });

  it("builds the balance strip from totals and balances", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ income: "5000", expense: "3000" }] })
      .mockResolvedValueOnce({ rows: [{ opening_paise: "1000", closing_paise: "1200" }] })
      .mockResolvedValueOnce({ rows: [{ closing_paise: "3000" }] });
    const res = await app.inject({ method: "GET", url: "/api/dashboard/balance-strip", headers: resident() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ opening: 1000, income: 5000, expense: 3000, net: 2000, closing: 3000 });
  });
});

describe("dashboard settings RBAC", () => {
  const validBody = [{ dashboard_key: "resident.cashflow", enabled: false, hidden_widgets: ["cashflow.summaryCards"] }];

  it("lets residents read visibility settings", async () => {
    db.query.mockResolvedValueOnce({ rows: validBody });
    const res = await app.inject({ method: "GET", url: "/api/admin/settings/dashboards", headers: resident() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(validBody);
    expect(db.query.mock.calls[0][1]).toEqual([COMMUNITY]);
  });

  for (const [role, headers] of [["resident", resident], ["admin", admin]] as const) {
    it(`blocks ${role} from changing visibility`, async () => {
      const res = await app.inject({ method: "PATCH", url: "/api/admin/settings/dashboards", headers: headers(), payload: validBody });
      expect(res.statusCode).toBe(403);
      expect(db.withTx).not.toHaveBeenCalled();
    });
  }

  it("lets superadmin save visibility and writes an audit entry", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/admin/settings/dashboards", headers: superadmin(), payload: validBody });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(validBody);
    const sql = db.txQuery.mock.calls.map(([text]) => String(text));
    expect(sql.some((s) => s.includes("INSERT INTO dashboard_settings"))).toBe(true);
    expect(sql.some((s) => s.includes("INSERT INTO audit_log"))).toBe(true);
    const upsert = db.txQuery.mock.calls.find(([text]) => String(text).includes("INSERT INTO dashboard_settings"))!;
    expect(upsert[1]).toEqual([COMMUNITY, "resident.cashflow", false, ["cashflow.summaryCards"]]);
  });

  it("accepts every resident dashboard key, including forecasting", async () => {
    const keys = ["overview", "drilldown", "cashflow", "income", "balance", "forecasting"]
      .map((k) => ({ dashboard_key: `resident.${k}`, enabled: true, hidden_widgets: [] }));
    const res = await app.inject({ method: "PATCH", url: "/api/admin/settings/dashboards", headers: superadmin(), payload: keys });
    expect(res.statusCode).toBe(200);
  });

  it("rejects unknown dashboard keys without writing", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/settings/dashboards",
      headers: superadmin(),
      payload: [{ dashboard_key: "resident.unknown", enabled: true, hidden_widgets: [] }],
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(db.withTx).not.toHaveBeenCalled();
  });
});
