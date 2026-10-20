import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTx } from "../db";
import { audit } from "../audit";

export const DASHBOARD_KEYS = [
  "resident.overview","resident.drilldown","resident.cashflow","resident.income","resident.balance",
  "resident.forecasting",
] as const;

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);

  app.get("/expense-info", async (req) => {
    const { rows } = await pool.query(
      `SELECT procurement_names FROM expense_info_settings WHERE community_id=$1`,
      [req.user.cid],
    );
    return { procurementNames: rows[0]?.procurement_names ?? ["One Time Operational Procurement"] };
  });

  app.patch("/expense-info", { preHandler: app.requireRole(["superadmin"]) }, async (req, reply) => {
    const parsed = z.object({
      procurementNames: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid procurement names", issues: parsed.error.issues });

    const seen = new Set<string>();
    const procurementNames = parsed.data.procurementNames.filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const p = req.user;
    const updated = await withTx(async (client) => {
      const { rows } = await client.query(
        `SELECT procurement_names FROM expense_info_settings WHERE community_id=$1`,
        [p.cid],
      );
      const before = { procurementNames: rows[0]?.procurement_names ?? ["One Time Operational Procurement"] };
      const after = { procurementNames };
      await client.query(
        `INSERT INTO expense_info_settings (community_id, procurement_names)
         VALUES ($1,$2)
         ON CONFLICT (community_id)
         DO UPDATE SET procurement_names=EXCLUDED.procurement_names`,
        [p.cid, procurementNames],
      );
      await audit({ communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "expense_info_settings", action: "settings", before, after }, client);
      return after;
    });
    return reply.send(updated);
  });

  // Residents may GET (to know what to show); only admins may PATCH.
  app.get("/dashboards", async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT dashboard_key, enabled, hidden_widgets FROM dashboard_settings WHERE community_id=$1`,
      [p.cid],
    );
    return rows;
  });

  // FIX (2026-08-15): "Dashboard Controls" is an Admin Controls screen --
  // only superadmin may change what's visible. GET above intentionally
  // stays open to any authenticated user, unchanged.
  app.patch("/dashboards", { preHandler: app.requireRole(["superadmin"]) }, async (req, reply) => {
    const p = req.user;
    const body = z.array(z.object({
      dashboard_key: z.enum(DASHBOARD_KEYS),
      enabled: z.boolean(),
      hidden_widgets: z.array(z.string()).default([]),
    })).parse(req.body);

    const updated = await withTx(async (c) => {
      const before = (await c.query(
        `SELECT dashboard_key, enabled, hidden_widgets FROM dashboard_settings WHERE community_id=$1`,
        [p.cid],
      )).rows;
      for (const row of body) {
        await c.query(
          `INSERT INTO dashboard_settings (community_id, dashboard_key, enabled, hidden_widgets)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (community_id, dashboard_key)
           DO UPDATE SET enabled=EXCLUDED.enabled, hidden_widgets=EXCLUDED.hidden_widgets`,
          [p.cid, row.dashboard_key, row.enabled, row.hidden_widgets],
        );
      }
      await audit({ communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "dashboard_settings", action: "settings", before, after: body }, c);
      return body;
    });
    return reply.send(updated);
  });
}
