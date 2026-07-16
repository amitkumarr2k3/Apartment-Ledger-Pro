import { FastifyInstance } from "fastify";
import { pool } from "../db";

export async function routes(app: FastifyInstance) {
  app.get("/ranking", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT vendor_name AS vendor, vendor_kind AS kind, categories AS category,
              total_expense_paise AS total, months_active
       FROM mv_vendor_ranking
       WHERE community_id=$1
       ORDER BY total_expense_paise DESC`,
      [p.cid],
    );
    return rows;
  });
}
