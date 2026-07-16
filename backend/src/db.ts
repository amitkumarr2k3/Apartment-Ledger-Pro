import { Pool, PoolClient } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function refreshRollups() {
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_totals").catch(async () => {
    await pool.query("REFRESH MATERIALIZED VIEW mv_monthly_totals");
  });
  await pool.query("REFRESH MATERIALIZED VIEW mv_category_monthly");
  await pool.query("REFRESH MATERIALIZED VIEW mv_vendor_ranking");
}
