// Seeds the database with data equivalent to the frontend's finance-mock.ts.
// Sparse months are represented as absent rows (design point 8).
import { Client } from "pg";
import argon2 from "argon2";


const MONTHS = [
  "2025-08-01","2025-09-01","2025-10-01","2025-11-01","2025-12-01","2026-01-01",
  "2026-02-01","2026-03-01","2026-04-01","2026-05-01","2026-06-01","2026-07-01",
];

const fill = (base: number, jitter: number, sparse: number[] = []) =>
  MONTHS.map((_, i) => sparse.includes(i) ? 0 : Math.max(0, Math.round(base + Math.sin(i) * jitter)));

const EXPENSES = [
  { cat: "Utilities", vendor: "Bescom", kind: "company", items: [
    { name: "Common area electricity", monthly: fill(48000,4000) },
    { name: "Backup usage", monthly: fill(12000,3500,[2,8]) }] },
  { cat: "Utilities", vendor: "BWSSB", kind: "company", items: [
    { name: "Water charges", monthly: fill(32000,2000) }] },
  { cat: "Maintenance", vendor: "ABC Enterprise", kind: "company", items: [
    { name: "Labour charges", monthly: fill(65000,3000) },
    { name: "Spare parts", monthly: fill(18000,6000,[1,4,7]) },
    { name: "STP salt purchase", monthly: fill(9000,500,[0,1,3,4,6,7,9,10]) }] },
  { cat: "Maintenance", vendor: "John (Plumber)", kind: "individual", items: [
    { name: "Plumbing repair", monthly: fill(4500,3500,[0,2,5,6,8,11]) }] },
  { cat: "Security", vendor: "SafeGuard Services", kind: "company", items: [
    { name: "Guard salaries", monthly: fill(120000,2000) }] },
  { cat: "Housekeeping", vendor: "CleanCo", kind: "company", items: [
    { name: "Staff wages", monthly: fill(58000,1500) },
    { name: "Cleaning supplies", monthly: fill(7500,1500) }] },
  { cat: "Petty Cash", vendor: "Office petty cash", kind: "individual", items: [
    { name: "Ad-hoc expenses", monthly: fill(6000,5500) }] },
];
const INCOMES = [
  { cat: "Maintenance Collections", vendor: "Monthly maintenance", kind: "company", items: [
    { name: "Flat maintenance dues", monthly: fill(340000,15000) }] },
  { cat: "Other Income", vendor: "Community Hall", kind: "company", items: [
    { name: "Hall rental", monthly: fill(18000,8000,[1,5,9]) },
    { name: "Event usage charges", monthly: fill(6000,4500,[0,2,4,6,8,10]) }] },
  { cat: "Other Income", vendor: "Signage Rental", kind: "individual", items: [
    { name: "Billboard fee", monthly: fill(12000,500) }] },
];

async function ensureSuperadmin(c: Client, communityId: string) {
  const superadmin = process.env.SUPERADMIN_EMAIL || "admin@example.com";
  const superadminPassword = process.env.SUPERADMIN_PASSWORD || "ChangeMe!2026";
  const pwHash = await argon2.hash(superadminPassword);
  await c.query(
    `INSERT INTO allowed_emails (email, community_id, role, name, invited_by)
     VALUES ($1,$2,'superadmin','Super Admin','system')
     ON CONFLICT (email) DO UPDATE SET role='superadmin', community_id=EXCLUDED.community_id`,
    [superadmin, communityId],
  );
  const superUserId = (await c.query(
    `INSERT INTO users (community_id, email, name, password_hash)
     VALUES ($1,$2,'Super Admin',$3)
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, community_id=EXCLUDED.community_id RETURNING id`,
    [communityId, superadmin, pwHash])).rows[0].id;
  await c.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1,'superadmin'),($1,'admin')
     ON CONFLICT DO NOTHING`, [superUserId]);
  console.log(`Superadmin ensured → email: ${superadmin}  password: ${superadminPassword}`);
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("BEGIN");
  try {
    const existing = await c.query(`SELECT id FROM communities LIMIT 1`);
    if (existing.rowCount) {
      console.log("Seed data already present — refreshing superadmin credentials only");
      await ensureSuperadmin(c, existing.rows[0].id);
      await c.query("COMMIT");
      await c.end();
      return;
    }


    const community = (await c.query(
      `INSERT INTO communities (name, currency, fy_start_month) VALUES ('Green Meadows','INR',4) RETURNING id`,
    )).rows[0].id;

    // Whitelist (superadmin row is upserted by ensureSuperadmin below)
    await c.query(`INSERT INTO allowed_emails (email, community_id, role, name, invited_by)
      VALUES ('treasurer@example.com',$1,'admin','Treasurer','system'),
             ('resident@example.com',$1,'resident','Demo Resident','system')`,
      [community]);

    await ensureSuperadmin(c, community);




    // Flats
    for (let i = 1; i <= 24; i++) {
      await c.query(`INSERT INTO flats (community_id, code) VALUES ($1,$2)`,
        [community, `A-${String(i).padStart(3,"0")}`]);
    }

    // Heads
    const expenseHeadId = (await c.query(
      `INSERT INTO heads (community_id, kind, name) VALUES ($1,'expense','Operating Expenses') RETURNING id`,
      [community])).rows[0].id;
    const incomeHeadId = (await c.query(
      `INSERT INTO heads (community_id, kind, name) VALUES ($1,'income','Operating Income') RETURNING id`,
      [community])).rows[0].id;

    async function seedTree(head: string, direction: "C"|"D", groups: any[]) {
      for (const g of groups) {
        const catId = (await c.query(
          `INSERT INTO categories (head_id, name) VALUES ($1,$2)
           ON CONFLICT (head_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
          [head, g.cat])).rows[0].id;
        const vendorId = (await c.query(
          `INSERT INTO vendors (community_id, name, kind) VALUES ($1,$2,$3)
           ON CONFLICT (community_id, name) DO UPDATE SET kind=EXCLUDED.kind RETURNING id`,
          [community, g.vendor, g.kind])).rows[0].id;
        for (const item of g.items) {
          const liId = (await c.query(
            `INSERT INTO line_items (category_id, vendor_id, name, first_seen_month, last_seen_month)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [catId, vendorId, item.name,
             MONTHS[item.monthly.findIndex((v:number)=>v>0)] ?? MONTHS[0],
             MONTHS.slice().reverse().find((_,i)=>item.monthly[item.monthly.length-1-i]>0) ?? MONTHS[MONTHS.length-1]]
          )).rows[0].id;
          for (let mi = 0; mi < MONTHS.length; mi++) {
            const amt = item.monthly[mi];
            if (!amt) continue;  // sparse: skip absent months entirely
            const day = 15;
            const date = `${MONTHS[mi].slice(0,7)}-${String(day).padStart(2,"0")}`;
            await c.query(
              `INSERT INTO transactions (community_id, txn_date, period_month, head_id, category_id,
                vendor_id, line_item_id, amount_paise, direction, source, source_ref)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'seed',$10)`,
              [community, date, MONTHS[mi], head, catId, vendorId, liId, amt * 100, direction,
               `seed|${g.cat}|${g.vendor}|${item.name}|${MONTHS[mi]}`],
            );
          }
        }
      }
    }
    await seedTree(expenseHeadId, "D", EXPENSES);
    await seedTree(incomeHeadId, "C", INCOMES);

    // Balances (compute from seeded transactions)
    let opening = 850000 * 100;
    for (const m of MONTHS) {
      const r = await c.query(
        `SELECT COALESCE(SUM(amount_paise) FILTER (WHERE direction='C'),0) AS ci,
                COALESCE(SUM(amount_paise) FILTER (WHERE direction='D'),0) AS de
         FROM transactions WHERE community_id=$1 AND period_month=$2`,
        [community, m]);
      const closing = Number(opening) + Number(r.rows[0].ci) - Number(r.rows[0].de);
      await c.query(`INSERT INTO balances (community_id, month, opening_paise, closing_paise)
        VALUES ($1,$2,$3,$4)`, [community, m, opening, closing]);
      opening = closing;
    }

    // Dashboard settings — all enabled
    for (const k of ["resident.overview","resident.drilldown","resident.cashflow","resident.income","resident.balance"]) {
      await c.query(`INSERT INTO dashboard_settings (community_id, dashboard_key, enabled) VALUES ($1,$2,true)
        ON CONFLICT DO NOTHING`, [community, k]);
    }

    // Refresh mviews
    await c.query(`REFRESH MATERIALIZED VIEW mv_monthly_totals`);
    await c.query(`REFRESH MATERIALIZED VIEW mv_category_monthly`);
    await c.query(`REFRESH MATERIALIZED VIEW mv_vendor_ranking`);

    await c.query("COMMIT");
    console.log("Seed complete");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
