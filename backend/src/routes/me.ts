import { FastifyInstance } from "fastify";
import { pool } from "../db";

export async function routes(app: FastifyInstance) {
  app.get("/me", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const ds = await pool.query(
      `SELECT dashboard_key, enabled, hidden_widgets FROM dashboard_settings WHERE community_id=$1`,
      [p.cid],
    );
    return {
      user: { id: p.sub, email: p.email, roles: p.roles, communityId: p.cid },
      dashboards: ds.rows,
    };
  });
}
