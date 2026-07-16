import { FastifyInstance } from "fastify";
import { pool, refreshRollups, withTx } from "../db";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { audit } from "../audit";

// Kinds of files the community will upload: transactions | residents | vendors
const KIND = z.enum(["transactions","residents","vendors"]);

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);
  app.addHook("preHandler", app.requireRole(["admin","superadmin"]));

  // List recent import batches (for Import history tab)
  app.get("/", async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT b.id, b.filename, b.kind, b.uploaded_by, b.row_count, b.status, b.created_at,
              u.email AS uploader_email,
              (SELECT COUNT(*)::int FROM import_staging s WHERE s.batch_id=b.id AND s.error IS NULL) AS committed
       FROM import_batches b
       LEFT JOIN users u ON u.id = b.uploaded_by
       WHERE b.community_id=$1
       ORDER BY b.created_at DESC
       LIMIT 50`,
      [p.cid],
    );
    return { rows };
  });

  // One-shot upload: stage + commit + refresh rollups. Frontend uses this after
  // client-side validation so the user gets a single "Committed" toast.
  app.post("/:kind", async (req, reply) => {
    const p = req.user;
    const { kind } = z.object({ kind: KIND }).parse(req.params);
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    const buf = await file.toBuffer();
    const rows = parse(buf, { columns: true, skip_empty_lines: true, trim: true });
    const batch = await pool.query(
      `INSERT INTO import_batches (community_id, filename, kind, uploaded_by, row_count)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [p.cid, file.filename, kind, p.sub, rows.length],
    );
    const batchId = batch.rows[0].id;
    let inserted = 0, failed = 0;
    await withTx(async (c) => {
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        // Per-row SAVEPOINT: a failing row must not abort the whole batch
        // (Postgres 25P02 "current transaction is aborted…" otherwise).
        await c.query("SAVEPOINT row_sp");
        try {
          await c.query(
            `INSERT INTO import_staging (batch_id, row_no, raw_json) VALUES ($1,$2,$3)`,
            [batchId, i + 1, raw],
          );
          if (kind === "transactions") {
            await commitTransactionRow(c, p.cid, raw);
          } else if (kind === "vendors") {
            await c.query(
              `INSERT INTO vendors (community_id, name, kind) VALUES ($1,$2,COALESCE($3::vendor_kind,'company'::vendor_kind))
               ON CONFLICT (community_id,name) DO NOTHING`,
              [p.cid, raw.name, raw.kind],
            );
          } else if (kind === "residents") {
            await c.query(
              `INSERT INTO allowed_emails (email, community_id, role, name, invited_by)
               VALUES ($1,$2,'resident',$3,$4) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name`,
              [String(raw.email).toLowerCase(), p.cid, raw.name ?? null, p.email],
            );
          }
          await c.query("RELEASE SAVEPOINT row_sp");
          inserted++;
        } catch (e: any) {
          failed++;
          await c.query("ROLLBACK TO SAVEPOINT row_sp");
          await c.query("RELEASE SAVEPOINT row_sp");
          // Best-effort: record the error on the staging row (may not exist
          // if the staging insert itself failed; ignore in that case).
          try {
            await c.query(
              `INSERT INTO import_staging (batch_id, row_no, raw_json, error)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (batch_id, row_no) DO UPDATE SET error=EXCLUDED.error`,
              [batchId, i + 1, raw, String(e?.message ?? e)],
            );
          } catch {
            // import_staging may lack a unique(batch_id,row_no) — fall back to UPDATE
            await c.query(
              `UPDATE import_staging SET error=$1 WHERE batch_id=$2 AND row_no=$3`,
              [String(e?.message ?? e), batchId, i + 1],
            );
          }
        }
      }
      await c.query(
        `UPDATE import_batches SET status=$2 WHERE id=$1`,
        [batchId, failed === 0 ? "committed" : (inserted === 0 ? "failed" : "partial")],
      );
      await audit({
        communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "import_batch", entityId: batchId, action: "import",
        after: { kind, filename: file.filename, rows: rows.length, inserted, failed },
        ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
      }, c);
    });
    if (kind === "transactions") await refreshRollups();
    return reply.send({ batchId, rows: rows.length, inserted, failed });
  });


  app.post("/:batchId/preview", async (req) => {
    const { batchId } = z.object({ batchId: z.string().uuid() }).parse(req.params);
    const staging = await pool.query(
      `SELECT row_no, raw_json FROM import_staging WHERE batch_id=$1 ORDER BY row_no LIMIT 50`,
      [batchId],
    );
    return { preview: staging.rows };
  });

  app.post("/:batchId/commit", async (req, reply) => {
    const p = req.user;
    const { batchId } = z.object({ batchId: z.string().uuid() }).parse(req.params);
    const batchRow = await pool.query(`SELECT * FROM import_batches WHERE id=$1 AND community_id=$2`,
      [batchId, p.cid]);
    if (batchRow.rowCount === 0) return reply.code(404).send({ error: "not_found" });
    const kind = batchRow.rows[0].kind as "transactions" | "residents" | "vendors";
    const staged = await pool.query(
      `SELECT row_no, raw_json FROM import_staging WHERE batch_id=$1 ORDER BY row_no`, [batchId],
    );

    let inserted = 0, failed = 0;
    await withTx(async (c) => {
      for (const s of staged.rows) {
        try {
          if (kind === "transactions") {
            await commitTransactionRow(c, p.cid, s.raw_json);
          } else if (kind === "vendors") {
            await c.query(
              `INSERT INTO vendors (community_id, name, kind) VALUES ($1,$2,COALESCE($3::vendor_kind,'company'::vendor_kind))
               ON CONFLICT (community_id,name) DO NOTHING`,
              [p.cid, s.raw_json.name, s.raw_json.kind],
            );
          } else if (kind === "residents") {
            await c.query(
              `INSERT INTO allowed_emails (email, community_id, role, name, invited_by)
               VALUES ($1,$2,'resident',$3,$4) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name`,
              [String(s.raw_json.email).toLowerCase(), p.cid, s.raw_json.name ?? null, p.email],
            );
          }
          inserted++;
        } catch (e: any) {
          failed++;
          await c.query(`UPDATE import_staging SET error=$1 WHERE batch_id=$2 AND row_no=$3`,
            [e.message, batchId, s.row_no]);
        }
      }
      await c.query(`UPDATE import_batches SET status='committed' WHERE id=$1`, [batchId]);
      await audit({ communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "import_batch", entityId: batchId, action: "import",
        after: { kind, inserted, failed } }, c);
    });
    if (kind === "transactions") await refreshRollups();
    return { inserted, failed };
  });
}

async function commitTransactionRow(c: any, communityId: string, r: any) {
  // Expected columns: date, head (income|expense), category, vendor?, line_item?, amount, direction (C|D), flat_code?
  const head = await upsert(c,
    `INSERT INTO heads (community_id, kind, name) VALUES ($1,$2,$3)
     ON CONFLICT (community_id, kind, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [communityId, r.head, r.head_name || r.category_head || (r.direction === "C" ? "Income" : "Expense")]);
  const cat = await upsert(c,
    `INSERT INTO categories (head_id, name) VALUES ($1,$2)
     ON CONFLICT (head_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [head, r.category]);
  let vendorId: string | null = null;
  if (r.vendor) {
    vendorId = await upsert(c,
      `INSERT INTO vendors (community_id, name, kind) VALUES ($1,$2,COALESCE($3::vendor_kind,'company'::vendor_kind))
       ON CONFLICT (community_id, name) DO UPDATE SET kind=EXCLUDED.kind RETURNING id`,
      [communityId, r.vendor, r.vendor_kind]);
  }
  const period = String(r.date).slice(0,7) + "-01";
  let lineItemId: string | null = null;
  if (r.line_item) {
    lineItemId = await upsert(c,
      `INSERT INTO line_items (category_id, vendor_id, name, first_seen_month, last_seen_month)
       VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (category_id, COALESCE(vendor_id,'00000000-0000-0000-0000-000000000000'::uuid), name)
       DO UPDATE SET last_seen_month = GREATEST(line_items.last_seen_month, EXCLUDED.last_seen_month)
       RETURNING id`,
      [cat, vendorId, r.line_item, period]);
  }
  let flatId: string | null = null;
  if (r.flat_code) {
    const f = await c.query(`SELECT id FROM flats WHERE community_id=$1 AND code=$2`,
      [communityId, r.flat_code]);
    flatId = f.rows[0]?.id ?? null;
  }
  const amountPaise = Math.round(Number(r.amount) * 100);
  await c.query(
    `INSERT INTO transactions
     (community_id, txn_date, period_month, head_id, category_id, vendor_id, line_item_id,
      flat_id, amount_paise, direction, source, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'csv',$11)
     ON CONFLICT (source, source_ref) DO NOTHING`,
    [communityId, r.date, period, head, cat, vendorId, lineItemId,
     flatId, amountPaise, r.direction, r.source_ref || `${r.date}|${r.category}|${r.vendor||""}|${r.line_item||""}|${amountPaise}`],
  );
}

async function upsert(c: any, sql: string, params: any[]): Promise<string> {
  const r = await c.query(sql, params);
  return r.rows[0].id;
}
