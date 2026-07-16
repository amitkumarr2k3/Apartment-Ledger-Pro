import { FastifyInstance } from "fastify";
import { pool } from "../db";

export async function routes(app: FastifyInstance) {
  // Nested tree: category → vendor → line_item with monthly totals
  app.get("/tree", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT h.name AS head, c.name AS category, v.name AS vendor, v.kind AS vendor_kind,
              li.name AS line_item, t.period_month AS month,
              SUM(t.amount_paise)::bigint AS amount
       FROM transactions t
       JOIN heads h ON h.id=t.head_id AND h.kind='expense'
       JOIN categories c ON c.id=t.category_id
       LEFT JOIN vendors v ON v.id=t.vendor_id
       LEFT JOIN line_items li ON li.id=t.line_item_id
       WHERE t.community_id=$1
       GROUP BY h.name, c.name, v.name, v.kind, li.name, t.period_month
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
       WHERE community_id=$1 AND head_kind='expense'
       GROUP BY category_name
       ORDER BY total DESC`,
      [p.cid],
    );
    return rows;
  });

  // Sparse-month-safe anomaly detection: uses only months where the category actually had activity
  app.get("/anomalies", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `WITH per AS (
         SELECT category_id, category_name, month, amount_paise,
                ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY month DESC) rn
         FROM mv_category_monthly
         WHERE community_id=$1 AND head_kind='expense'
       ),
       cur AS (SELECT * FROM per WHERE rn=1),
       prev AS (SELECT category_id, AVG(amount_paise) avg3
                FROM per WHERE rn BETWEEN 2 AND 4 GROUP BY category_id)
       SELECT cur.category_name AS category, cur.amount_paise AS cur, prev.avg3 AS avg,
              (cur.amount_paise::numeric / NULLIF(prev.avg3,0)) AS ratio
       FROM cur JOIN prev USING (category_id)
       WHERE prev.avg3 > 0 AND cur.amount_paise::numeric / prev.avg3 >= 1.5
       ORDER BY ratio DESC`,
      [p.cid],
    );
    return rows;
  });
}
