import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTx } from "../db";
import { audit } from "../audit";

export const DASHBOARD_KEYS = [
  "resident.overview","resident.drilldown","resident.cashflow","resident.income","resident.balance",
] as const;

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);

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
