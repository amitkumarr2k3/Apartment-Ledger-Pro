import { FastifyInstance } from "fastify";
import { pool } from "../db";
import { z } from "zod";

const range = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function routes(app: FastifyInstance) {
  app.get("/monthly-totals", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { from, to } = range.parse(req.query);
    const { rows } = await pool.query(
      `SELECT month, collection_paise, expense_paise, net_paise
       FROM mv_monthly_totals
       WHERE community_id=$1
         AND ($2::date IS NULL OR month >= $2::date)
         AND ($3::date IS NULL OR month <= $3::date)
       ORDER BY month`,
      [p.cid, from ?? null, to ?? null],
    );
    return rows;
  });

  app.get("/balance-strip", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const { from, to } = range.parse(req.query);
    const totals = await pool.query(
      `SELECT COALESCE(SUM(collection_paise),0) AS income,
              COALESCE(SUM(expense_paise),0) AS expense
       FROM mv_monthly_totals
       WHERE community_id=$1
         AND ($2::date IS NULL OR month >= $2::date)
         AND ($3::date IS NULL OR month <= $3::date)`,
      [p.cid, from ?? null, to ?? null],
    );
    const bal = await pool.query(
      `SELECT opening_paise, closing_paise FROM balances
       WHERE community_id=$1
       ORDER BY month ASC LIMIT 1`,
      [p.cid],
    );
    const closingRow = await pool.query(
      `SELECT closing_paise FROM balances
       WHERE community_id=$1
       ORDER BY month DESC LIMIT 1`,
      [p.cid],
    );
    return {
      opening: Number(bal.rows[0]?.opening_paise ?? 0),
      income: Number(totals.rows[0].income ?? 0),
      expense: Number(totals.rows[0].expense ?? 0),
      net: Number(totals.rows[0].income ?? 0) - Number(totals.rows[0].expense ?? 0),
      closing: Number(closingRow.rows[0]?.closing_paise ?? 0),
    };
  });
}
