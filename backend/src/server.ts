import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { registerAuth } from "./auth";
import { routes as authRoutes } from "./routes/auth";
import { routes as meRoutes } from "./routes/me";
import { routes as dashRoutes } from "./routes/dashboard";
import { routes as expensesRoutes } from "./routes/expenses";
import { routes as incomeRoutes } from "./routes/income";
import { routes as vendorsRoutes } from "./routes/vendors";
import { routes as collectionsRoutes } from "./routes/collections";
import { routes as reportsRoutes } from "./routes/reports";
import { routes as adminTxnRoutes } from "./routes/admin.transactions";
import { routes as adminResRoutes } from "./routes/admin.residents";
// admin.vendors removed — vendor master is not user-managed (imported via CSV / auto-created).
import { routes as adminSettingsRoutes } from "./routes/admin.settings";
import { routes as adminAuditRoutes } from "./routes/admin.audit";
import { routes as adminImportsRoutes } from "./routes/admin.imports";
import { routes as adminETLRoutes } from "./routes/admin.etl";
import { pool } from "./db";

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
  const allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });

  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await registerAuth(app);

  // Liveness — process is up. No DB check, cheap.
  app.get("/health", async () => ({ ok: true, status: "live" }));

  // Readiness — DB reachable AND all migrations applied. Use this from
  // orchestrators and the smoke test to distinguish "process up" from
  // "actually ready to serve traffic".
  app.get("/ready", async (_req, reply) => {
    const checks: Record<string, unknown> = {};
    try {
      const t0 = Date.now();
      const r = await pool.query("SELECT 1 AS ok");
      checks.db = { ok: r.rows[0]?.ok === 1, latency_ms: Date.now() - t0 };
    } catch (e: any) {
      checks.db = { ok: false, error: String(e?.message ?? e) };
      return reply.code(503).send({ ok: false, status: "not-ready", checks });
    }
    try {
      const m = await pool.query(
        `SELECT name, run_at FROM _migrations ORDER BY name`,
      );
      checks.migrations = {
        ok: m.rowCount && m.rowCount > 0,
        applied: m.rowCount,
        last: m.rows[m.rows.length - 1] ?? null,
        names: m.rows.map((r) => r.name),
      };
      if (!m.rowCount) {
        return reply.code(503).send({ ok: false, status: "no-migrations", checks });
      }
    } catch (e: any) {
      checks.migrations = { ok: false, error: String(e?.message ?? e) };
      return reply.code(503).send({ ok: false, status: "migrations-missing-table", checks });
    }
    return { ok: true, status: "ready", checks };
  });


  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(meRoutes, { prefix: "/api" });
  await app.register(dashRoutes, { prefix: "/api/dashboard" });
  await app.register(expensesRoutes, { prefix: "/api/expenses" });
  await app.register(incomeRoutes, { prefix: "/api/income" });
  await app.register(vendorsRoutes, { prefix: "/api/vendors" });
  await app.register(collectionsRoutes, { prefix: "/api/collections" });
  await app.register(reportsRoutes, { prefix: "/api/reports" });
  await app.register(adminTxnRoutes, { prefix: "/api/admin/transactions" });
  await app.register(adminResRoutes, { prefix: "/api/admin/residents" });
  // vendor CRUD removed — /api/vendors (read-only insights) still available
  await app.register(adminSettingsRoutes, { prefix: "/api/admin/settings" });
  await app.register(adminAuditRoutes, { prefix: "/api/admin/audit" });
  await app.register(adminImportsRoutes, { prefix: "/api/admin/imports" });
  await app.register(adminETLRoutes, { prefix: "/api/admin/etl" });

  return app;
}

if (require.main === module) {
  // Startup diagnostics — surfaces the resolved entrypoint and env
  // so container exits are easier to trace from `docker compose logs api`.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      msg: "api-boot",
      entrypoint: __filename,
      cwd: process.cwd(),
      node: process.version,
      port: Number(process.env.PORT || 4000),
      db: process.env.DATABASE_URL ? "configured" : "MISSING",
      nodeEnv: process.env.NODE_ENV || "development",
    }),
  );
  buildApp()
    .then((app) =>
      app
        .listen({ host: "0.0.0.0", port: Number(process.env.PORT || 4000) })
        .then((addr) => app.log.info(`api listening on ${addr}`))
        .catch((e) => {
          app.log.error(e);
          process.exit(1);
        }),
    )
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("api-boot-failed", e);
      process.exit(1);
    });
}
