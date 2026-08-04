import { FastifyInstance } from "fastify";
import { pool, refreshRollups, withTx } from "../db";
import { z } from "zod";
import {
  saveUploadedFiles,
  runETLTransformation,
  readTransformedTransactions,
  getOutputFiles,
} from "../etl";
import { audit } from "../audit";
import { parse } from "csv-parse/sync";

const ETLFileKind = z.enum(["expense", "receipt", "vendor"]);
type ETLFileKindValue = z.infer<typeof ETLFileKind>;

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);
  app.addHook("preHandler", app.requireRole(["admin", "superadmin"]));

  /**
   * Upload ETL files (expense, receipt, vendor)
   * POST /admin/etl/upload
   * Multipart form with files
   */
  app.post("/upload", async (req, reply) => {
    const p = req.user;

    try {
      const parts = (req as any).parts();
      const files: { filename: string; buffer: Buffer; kind: ETLFileKindValue }[] = [];

      for await (const part of parts) {
        if (part.type === "file") {
          // Validate field name (should be 'expense', 'receipt', or 'vendor')
          const kind = ETLFileKind.safeParse(part.fieldname);
          if (!kind.success) {
            return reply
              .code(400)
              .send({
                error: "invalid_file_type",
                message: "File type must be 'expense', 'receipt', or 'vendor'",
              });
          }

          const buffer = await part.toBuffer();
          files.push({
            filename: part.filename,
            buffer,
            kind: kind.data,
          });
        }
      }

      if (files.length === 0) {
        return reply
          .code(400)
          .send({ error: "no_files", message: "At least one file must be uploaded" });
      }

      // Save files to input directory
      const { inputFiles, sessionId } = await saveUploadedFiles(files);

      // Run ETL transformation
      const result = await runETLTransformation(inputFiles, sessionId);

      if (!result.success) {
        await audit(
          {
            communityId: p.cid,
            actorUserId: p.sub,
            actorEmail: p.email,
            entity: "import_batch",
            entityId: sessionId,
            action: "import",
            after: {
              sessionId,
              inputFiles,
              error: result.error,
              logs: result.logs,
            },
            ip: req.ip,
            userAgent: req.headers["user-agent"] ?? null,
          }
        );

        return reply.code(400).send({
          success: false,
          sessionId,
          message: result.message,
          error: result.error,
          logs: result.logs,
        });
      }

      // Read the transformed transactions CSV
      const csvBuffer = await readTransformedTransactions();
      const csvText = csvBuffer.toString("utf-8");
      const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      // Create import batch from transformed data
      const importBatch = await pool.query(
        `INSERT INTO import_batches (community_id, filename, kind, uploaded_by, row_count)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [p.cid, "etl-transformed-transactions.csv", "transactions", p.sub, rows.length]
      );

      const importBatchId = importBatch.rows[0].id;

      // Auto-import the transformed transactions
      let inserted = 0,
        failed = 0;
      await withTx(async (c) => {
        for (let i = 0; i < rows.length; i++) {
          const raw = rows[i];
          await c.query("SAVEPOINT row_sp");
          try {
            await c.query(
              `INSERT INTO import_staging (batch_id, row_no, raw_json) VALUES ($1,$2,$3)`,
              [importBatchId, i + 1, raw]
            );

            // Commit the transaction row
            await commitTransactionRow(c, p.cid, raw);
            await c.query("RELEASE SAVEPOINT row_sp");
            inserted++;
          } catch (e: any) {
            failed++;
            await c.query("ROLLBACK TO SAVEPOINT row_sp");
            await c.query("RELEASE SAVEPOINT row_sp");
            try {
              await c.query(
                `INSERT INTO import_staging (batch_id, row_no, raw_json, error)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (batch_id, row_no) DO UPDATE SET error=EXCLUDED.error`,
                [importBatchId, i + 1, raw, String(e?.message ?? e)]
              );
            } catch {
              await c.query(
                `UPDATE import_staging SET error=$1 WHERE batch_id=$2 AND row_no=$3`,
                [String(e?.message ?? e), importBatchId, i + 1]
              );
            }
          }
        }

        await c.query(`UPDATE import_batches SET status=$2 WHERE id=$1`, [
          importBatchId,
          failed === 0 ? "committed" : inserted === 0 ? "failed" : "partial",
        ]);

        await audit(
          {
            communityId: p.cid,
            actorUserId: p.sub,
            actorEmail: p.email,
            entity: "import_batch",
            entityId: importBatchId,
            action: "import",
            after: {
              sessionId,
              inputFiles,
              importBatchId,
              rows: rows.length,
              inserted,
              failed,
            },
            ip: req.ip,
            userAgent: req.headers["user-agent"] ?? null,
          },
          c
        );
      });

      await refreshRollups();

      return reply.send({
        success: true,
        sessionId,
        batchId: importBatchId,
        importBatchId,
        message: "ETL process completed and transactions imported",
        stats: {
          inputFiles: inputFiles.length,
          outputFiles: result.outputFiles?.length ?? 0,
          transactionsImported: inserted,
          transactionsFailed: failed,
        },
        logs: result.logs,
      });
    } catch (error) {
      const err = error as any;
      console.error("ETL upload error:", err);

      return reply.code(500).send({
        error: "etl_error",
        message: "Failed to process ETL upload",
        details: err.message,
      });
    }
  });

  /**
   * Get status of ETL transformations
   * GET /admin/etl/sessions
   */
  app.get("/sessions", async (req) => {
    const p = req.user;

    const { rows } = await pool.query(
      `SELECT
         id,
         id::text AS session_id,
         uploaded_by,
         jsonb_build_array(filename) AS input_files,
         status,
         error AS error_message,
         created_at
       FROM import_batches
       WHERE community_id = $1
         AND kind = 'transactions'
         AND filename = 'etl-transformed-transactions.csv'
       ORDER BY created_at DESC
       LIMIT 50`,
      [p.cid]
    );

    return { sessions: rows };
  });

  /**
   * Get ETL session details
   * GET /admin/etl/sessions/:sessionId
   */
  app.get("/sessions/:sessionId", async (req) => {
    const p = req.user;
    const { sessionId } = z.object({ sessionId: z.string() }).parse(req.params);

    const { rows } = await pool.query(
      `SELECT
         id,
         id::text AS session_id,
         uploaded_by,
         jsonb_build_array(filename) AS input_files,
         status,
         error AS error_message,
         created_at
       FROM import_batches
       WHERE community_id = $1
         AND id = $2::uuid
         AND kind = 'transactions'
         AND filename = 'etl-transformed-transactions.csv'`,
      [p.cid, sessionId]
    );

    if (rows.length === 0) {
      return { error: "not_found" };
    }

    return { session: rows[0] };
  });

  /**
   * Get available output files
   * GET /admin/etl/output-files
   */
  app.get("/output-files", async (req) => {
    try {
      const files = await getOutputFiles();
      return { files };
    } catch (error) {
      return {
        files: [],
        error: "Failed to read output files",
      };
    }
  });
}

/**
 * Helper function to commit a transaction row
 * Mirrors the logic from admin.imports.ts
 */
async function commitTransactionRow(c: any, communityId: string, r: any) {
  // Expected columns: date, head (income|expense), category, vendor?, line_item?, amount, direction (C|D), flat_code?
  const head = await upsert(
    c,
    `INSERT INTO heads (community_id, kind, name) VALUES ($1,$2,$3)
     ON CONFLICT (community_id, kind, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [
      communityId,
      r.head,
      r.head_name || r.category_head || (r.direction === "C" ? "Income" : "Expense"),
    ]
  );

  const cat = await upsert(
    c,
    `INSERT INTO categories (head_id, name) VALUES ($1,$2)
     ON CONFLICT (head_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [head, r.category]
  );

  let vendorId: string | null = null;
  const vendorName = (r.vendor ?? "").trim();
  const vendorKind = (r.vendor_kind ?? "individual").toString().toLowerCase().trim();
  if (vendorName) {
    vendorId = await upsert(
      c,
      `INSERT INTO vendors (community_id, name, kind)
       VALUES ($1,$2,COALESCE($3::vendor_kind,'company'::vendor_kind))
       ON CONFLICT (community_id, name) DO UPDATE SET kind=EXCLUDED.kind RETURNING id`,
      [communityId, vendorName, vendorKind === "company" ? "company" : "individual"]
    );
  }

  const period = String(r.date).slice(0, 7) + "-01";
  let lineItemId: string | null = null;
  if (r.line_item) {
    lineItemId = await upsert(
      c,
      `INSERT INTO line_items (category_id, vendor_id, name, first_seen_month, last_seen_month)
       VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (category_id, COALESCE(vendor_id,'00000000-0000-0000-0000-000000000000'::uuid), name)
       DO UPDATE SET last_seen_month = GREATEST(line_items.last_seen_month, EXCLUDED.last_seen_month)
       RETURNING id`,
      [cat, vendorId, r.line_item, period]
    );
  }

  let flatId: string | null = null;
  if (r.flat_code) {
    const f = await c.query(`SELECT id FROM flats WHERE community_id=$1 AND code=$2`, [
      communityId,
      r.flat_code,
    ]);
    if (f.rows.length > 0) flatId = f.rows[0].id;
  }

  const amountPaise = Math.round(Number(r.amount) * 100);
  const direction = String(r.direction ?? "D").toUpperCase().trim();
  // Use the source_ref from transform.py if present; it is already unique per row.
  const sourceRef = (r.source_ref ?? "").trim() ||
    `${r.date}|${r.category}|${vendorName}|${r.line_item ?? ""}|${r.amount}`;

  await c.query(
    `INSERT INTO transactions
     (community_id, txn_date, period_month, head_id, category_id, vendor_id, line_item_id,
      flat_id, amount_paise, direction, source, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'csv',$11)
     ON CONFLICT (source, source_ref) DO NOTHING`,
    [
      communityId,
      r.date,
      period,
      head,
      cat,
      vendorId,
      lineItemId,
      flatId,
      amountPaise,
      direction,
      sourceRef,
    ]
  );
}

/**
 * Helper to insert or update and return ID
 */
async function upsert(c: any, query: string, params: any[]): Promise<string> {
  const result = await c.query(query, params);
  return result.rows[0].id;
}
