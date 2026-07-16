import { FastifyInstance } from "fastify";
import { pool } from "../db";

export async function routes(app: FastifyInstance) {
  app.get("/tree", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT c.name AS category, v.name AS vendor, li.name AS line_item,
              t.period_month AS month, SUM(t.amount_paise)::bigint AS amount
       FROM transactions t
       JOIN heads h ON h.id=t.head_id AND h.kind='income'
       JOIN categories c ON c.id=t.category_id
       LEFT JOIN vendors v ON v.id=t.vendor_id
       LEFT JOIN line_items li ON li.id=t.line_item_id
       WHERE t.community_id=$1
       GROUP BY c.name, v.name, li.name, t.period_month
       ORDER BY c.name, v.name, li.name, t.period_month`,
      [p.cid],
    );
    return rows;
  });

  app.get("/category-totals", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT category_name AS name, SUM(amount_paise)::bigint AS total
       FROM mv_category_monthly
       WHERE community_id=$1 AND head_kind='income'
       GROUP BY category_name
       ORDER BY total DESC`,
      [p.cid],
    );
    return rows;
  });
}
