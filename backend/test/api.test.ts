import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { asksForDashboardFigure } from "../src/routes/assistant";

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

function cookieFor(roles: string[], communityId = COMMUNITY) {
  const token = app.jwt.sign({ sub: "user-1", email: `${roles[0] ?? "resident"}@example.com`, roles, cid: communityId });
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

describe("dashboard assistant", () => {
  it("distinguishes figure requests from concept questions", () => {
    expect(asksForDashboardFigure("How much are the outstanding receivables?")).toBe(true);
    expect(asksForDashboardFigure("What does total income mean?")).toBe(false);
  });

  it("returns a local refusal for dashboard figure requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/assistant/ask",
      headers: resident(),
      payload: { question: "How much are the outstanding receivables?", currentView: "overview" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().answer).toContain("can't provide, retrieve, or calculate dashboard figures");
  });
});

describe("procurement name settings", () => {
  const url = "/api/admin/settings/expense-info";
  const originalName = "One Time Operational Procurement";

  for (const role of ["resident", "admin", "superadmin"]) {
    it(`lets ${role} read the default mapping`, async () => {
      const response = await app.inject({ method: "GET", url, headers: cookieFor([role]) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ procurementNames: [originalName] });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("WHERE community_id=$1"), [COMMUNITY]);
    });
  }

  for (const method of ["GET", "PATCH"] as const) {
    it(`rejects anonymous ${method}`, async () => {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
      expect(db.query).not.toHaveBeenCalled();
      expect(db.withTx).not.toHaveBeenCalled();
    });
  }

  for (const role of ["resident", "admin"]) {
    it(`blocks ${role} from saving`, async () => {
      const response = await app.inject({ method: "PATCH", url, headers: cookieFor([role]), payload: { procurementNames: ["Equipment"] } });
      expect(response.statusCode).toBe(403);
      expect(db.withTx).not.toHaveBeenCalled();
    });
  }

  it("lets superadmin replace the original alias, normalizes names and audits the change", async () => {
    db.txQuery.mockResolvedValueOnce({ rows: [{ procurement_names: [originalName] }] });
    const response = await app.inject({
      method: "PATCH", url, headers: superadmin(),
      payload: { procurementNames: [" Equipment ", "equipment", "Capital Purchases"] },
    });
    const after = { procurementNames: ["Equipment", "Capital Purchases"] };
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(after);
    expect(db.txQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO expense_info_settings"), [COMMUNITY, after.procurementNames]);
    const auditCall = db.txQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO audit_log"));
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain(COMMUNITY);
    expect(auditCall![1]).toContain(JSON.stringify({ procurementNames: [originalName] }));
    expect(auditCall![1]).toContain(JSON.stringify(after));
  });

  for (const payload of [
    {}, { procurementNames: [] }, { procurementNames: [""] }, { procurementNames: ["  "] },
    { procurementNames: [42] }, { procurementNames: null }, { procurementNames: "Equipment" },
    { procurementNames: ["x".repeat(201)] }, { procurementNames: Array(51).fill("Equipment") },
  ]) {
    it(`rejects invalid input ${JSON.stringify(payload)}`, async () => {
      const response = await app.inject({ method: "PATCH", url, headers: superadmin(), payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("Invalid procurement names");
      expect(db.withTx).not.toHaveBeenCalled();
    });
  }

  it("accepts the name count and length limits", async () => {
    const procurementNames = Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(200, "x"));
    const response = await app.inject({ method: "PATCH", url, headers: superadmin(), payload: { procurementNames } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ procurementNames });
  });

  it("isolates persisted settings by the authenticated community, ignoring body scope", async () => {
    const otherCommunity = "22222222-2222-2222-2222-222222222222";
    const settings = new Map<string, string[]>();
    db.query.mockImplementation(async (_sql, [communityId]) => ({
      rows: settings.has(communityId) ? [{ procurement_names: settings.get(communityId) }] : [],
    }));
    db.txQuery.mockImplementation(async (sql, params) => {
      if (String(sql).includes("INSERT INTO expense_info_settings")) settings.set(params[0], params[1]);
      if (String(sql).includes("SELECT procurement_names")) {
        return { rows: settings.has(params[0]) ? [{ procurement_names: settings.get(params[0]) }] : [] };
      }
      return { rows: [] };
    });
    for (const [communityId, name] of [[COMMUNITY, "Equipment"], [otherCommunity, "Capital"]]) {
      const response = await app.inject({
        method: "PATCH", url, headers: cookieFor(["superadmin"], communityId),
        payload: { procurementNames: [name], community_id: "untrusted-community" },
      });
      expect(response.statusCode).toBe(200);
      expect(db.txQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE community_id=$1"), [communityId]);
    }
    for (const [communityId, name] of [[COMMUNITY, "Equipment"], [otherCommunity, "Capital"]]) {
      const response = await app.inject({ method: "GET", url, headers: cookieFor(["resident"], communityId) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ procurementNames: [name] });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("WHERE community_id=$1"), [communityId]);
    }
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

describe("chart annotations", () => {
  const annotation = {
    chartKey: "drilldown:expense:One Time Operational Procurement",
    pointKey: "Aug '26",
    title: "Emergency repair",
    comment: "One-time replacement after monsoon damage.",
    visibility: "all",
  };

  it("restricts writes and deletes to superadmin", async () => {
    for (const headers of [resident(), admin()]) {
      const put = await app.inject({ method: "PUT", url: "/api/annotations", headers, payload: annotation });
      const del = await app.inject({ method: "DELETE", url: "/api/annotations", headers, payload: { chartKey: annotation.chartKey, pointKey: annotation.pointKey } });
      expect(put.statusCode).toBe(403);
      expect(del.statusCode).toBe(403);
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it("filters visible annotations for resident and admin readers", async () => {
    await app.inject({ method: "GET", url: `/api/annotations?chartKey=${encodeURIComponent(annotation.chartKey)}`, headers: resident() });
    expect(db.query.mock.calls.at(-1)?.[1]).toEqual([COMMUNITY, annotation.chartKey, "resident"]);

    await app.inject({ method: "GET", url: `/api/annotations?chartKey=${encodeURIComponent(annotation.chartKey)}`, headers: admin() });
    expect(db.query.mock.calls.at(-1)?.[1]).toEqual([COMMUNITY, annotation.chartKey, "admin"]);
  });

  it("saves annotations independently from transaction imports", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: "annotation-1", ...annotation }], rowCount: 1 });
    const res = await app.inject({ method: "PUT", url: "/api/annotations", headers: superadmin(), payload: annotation });
    expect(res.statusCode).toBe(200);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toContain("INSERT INTO chart_annotations");
    expect(sql).toContain("ON CONFLICT");
    expect(db.query.mock.calls[0][1]).toEqual(expect.arrayContaining([COMMUNITY, annotation.chartKey, annotation.pointKey, annotation.title, annotation.comment, annotation.visibility]));
  });

  it("accepts exact maximum lengths and all supported visibility values", async () => {
    for (const visibility of ["all", "resident", "admin"]) {
      db.query.mockResolvedValueOnce({ rows: [{ id: "annotation-1" }], rowCount: 1 });
      const res = await app.inject({
        method: "PUT",
        url: "/api/annotations",
        headers: superadmin(),
        payload: {
          ...annotation,
          chartKey: "c".repeat(500),
          pointKey: "p".repeat(120),
          title: "t".repeat(160),
          comment: "m".repeat(4000),
          visibility,
        },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it.each([
    ["blank title", { title: "   " }],
    ["blank comment", { comment: "   " }],
    ["title over limit", { title: "t".repeat(161) }],
    ["comment over limit", { comment: "m".repeat(4001) }],
    ["chart key over limit", { chartKey: "c".repeat(501) }],
    ["point key over limit", { pointKey: "p".repeat(121) }],
    ["invalid visibility", { visibility: "public" }],
    ["missing title", { title: undefined }],
  ])("rejects %s with a 400 without querying the database", async (_name, patch) => {
    const res = await app.inject({ method: "PUT", url: "/api/annotations", headers: superadmin(), payload: { ...annotation, ...patch } });
    expect(res.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects anonymous annotation reads and writes", async () => {
    const read = await app.inject({ method: "GET", url: `/api/annotations?chartKey=${encodeURIComponent(annotation.chartKey)}` });
    const write = await app.inject({ method: "PUT", url: "/api/annotations", payload: annotation });
    expect(read.statusCode).toBe(401);
    expect(write.statusCode).toBe(401);
  });

  it("rejects missing and oversized chart query keys", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/annotations", headers: resident() });
    const oversized = await app.inject({ method: "GET", url: `/api/annotations?chartKey=${"c".repeat(501)}`, headers: resident() });
    expect(missing.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns 404 when deleting a comment that does not exist", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await app.inject({ method: "DELETE", url: "/api/annotations", headers: superadmin(), payload: { chartKey: annotation.chartKey, pointKey: annotation.pointKey } });
    expect(res.statusCode).toBe(404);
  });

  it("deletes by community, chart and point to preserve other users' data", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await app.inject({ method: "DELETE", url: "/api/annotations", headers: superadmin(), payload: { chartKey: annotation.chartKey, pointKey: annotation.pointKey } });
    expect(res.statusCode).toBe(200);
    expect(db.query.mock.calls[0][1]).toEqual([COMMUNITY, annotation.chartKey, annotation.pointKey]);
  });
});
