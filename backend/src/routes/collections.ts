import { FastifyInstance } from "fastify";
import { pool } from "../db";
import { z } from "zod";

export async function routes(app: FastifyInstance) {
  app.get("/", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { period } = z.object({ period: z.string().optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT f.code AS flat, d.period_month, d.dues_paise, d.paid_paise, d.status
       FROM collections_dues d
       JOIN flats f ON f.id = d.flat_id
       WHERE f.community_id=$1
         AND ($2::date IS NULL OR d.period_month = $2::date)
       ORDER BY d.period_month DESC, f.code`,
      [p.cid, period ?? null],
    );
    return rows;
  });
}
