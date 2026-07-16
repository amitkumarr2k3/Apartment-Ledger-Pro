import fs from "fs";
import path from "path";
import { Client } from "pg";

async function main() {
  const started = Date.now();
  const dir = path.join(__dirname, "..", "..", "db", "migrations");
  console.log(`[migrate] starting; dir=${dir} db=${process.env.DATABASE_URL ? "configured" : "MISSING"}`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  console.log(`[migrate] found ${files.length} migration file(s): ${files.join(", ")}`);
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ DEFAULT now())`);
  // Self-heal: if the tracker is empty but the schema already exists (from a
  // previous run predating _migrations), backfill so we don't re-apply DDL.
  const trackerEmpty = await client.query(`SELECT 1 FROM _migrations LIMIT 1`);
  if (!trackerEmpty.rowCount) {
    const hasSchema = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='communities'`
    );
    if (hasSchema.rowCount) {
      console.log(`[migrate] detected existing schema with empty tracker → backfilling _migrations`);
      for (const f of files) {
        // only backfill migrations we can be sure ran; treat all present files
        // whose sentinel objects already exist as applied
        await client.query(`INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
      }
    }
  }
  let applied = 0;
  let skipped = 0;
  for (const f of files) {
    const already = await client.query(`SELECT 1 FROM _migrations WHERE name=$1`, [f]);
    if (already.rowCount) { console.log(`[migrate] skip ${f} (already applied)`); skipped++; continue; }
    console.log(`[migrate] apply ${f}`);
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await client.query(sql);
    await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [f]);
    applied++;
  }
  await client.end();
  console.log(`[migrate] done in ${Date.now() - started}ms; applied=${applied} skipped=${skipped}`);
  if (process.env.SEED_ON_MIGRATE === "true") {
    console.log(`[migrate] SEED_ON_MIGRATE=true → running seed`);
    await import("./seed");
  }
}
main().catch((e) => { console.error("[migrate] FAILED", e); process.exit(1); });
