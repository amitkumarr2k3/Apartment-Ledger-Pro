import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { audit } from "../audit";

// Audited Report widget: Superadmin uploads a PDF per fiscal year; Resident
// and Admin can view it inline (never download). One report per FY --
// re-uploading for the same FY replaces the previous one (see the
// ON CONFLICT (community_id, fiscal_year) upsert below). Requires the
// "audited_reports" table -- see the SQL provided alongside this file.
//
// Mounted at /api/reports (NOT under /api/admin/...) because GET must be
// reachable by every authenticated role, not just admins -- matching the
// same pattern as income.ts/expenses.ts/vendors.ts (file-level app.auth
// only, with role checks applied per-route for the write operations).
export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);

  // List available reports for this community (metadata only, not the file
  // bytes -- keeps the dashboard widget's list call light).
  app.get("/", async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT id, fiscal_year, title, file_name, mime_type, uploaded_at
       FROM audited_reports
       WHERE community_id=$1
       ORDER BY fiscal_year DESC`,
      [p.cid],
    );
    return { rows };
  });

  // Serve the PDF bytes for INLINE viewing (never as a download prompt).
  // Any authenticated user (resident/admin/superadmin) can view.
  app.get("/:id/file", async (req, reply) => {
    const p = req.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await pool.query(
      `SELECT file_name, mime_type, file_data
       FROM audited_reports WHERE id=$1 AND community_id=$2`,
      [id, p.cid],
    );
    if (r.rowCount === 0) return reply.code(404).send({ error: "not_found" });
    const row = r.rows[0];
    return reply
      .header("Content-Type", row.mime_type || "application/pdf")
      // "inline" (not "attachment") is what makes the browser render the
      // PDF in its built-in viewer instead of triggering a download.
      .header("Content-Disposition", `inline; filename="${row.file_name.replace(/"/g, "")}"`)
      .send(row.file_data);
  });

  // Upload (or replace) the report for a given fiscal year. Superadmin only.
  // fiscalYear is a URL param (not a form field) -- matches the exact
  // pattern admin.imports.ts already uses for its /:kind upload route,
  // avoiding any multipart "extra form fields" complexity.
  app.post("/:fiscalYear", { preHandler: app.requireRole(["superadmin"]) }, async (req, reply) => {
    const p = req.user;
    const { fiscalYear } = z.object({ fiscalYear: z.string().min(1).max(20) }).parse(req.params);
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    if (file.mimetype !== "application/pdf") {
      return reply.code(400).send({ error: "pdf_only" });
    }
    const buf = await file.toBuffer();

    const r = await pool.query(
      `INSERT INTO audited_reports (community_id, fiscal_year, file_name, mime_type, file_data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (community_id, fiscal_year)
       DO UPDATE SET file_name=EXCLUDED.file_name, mime_type=EXCLUDED.mime_type,
         file_data=EXCLUDED.file_data, uploaded_by=EXCLUDED.uploaded_by, uploaded_at=now()
       RETURNING id, fiscal_year, file_name, uploaded_at`,
      [p.cid, fiscalYear, file.filename, file.mimetype, buf, p.sub],
    );
    const saved = r.rows[0];

    await audit({
      communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
      entity: "audited_report", entityId: saved.id, action: "upload",
      after: { fiscal_year: fiscalYear, file_name: file.filename },
      ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
    });

    return reply.code(201).send(saved);
  });

  // Remove a report. Superadmin only.
  app.delete("/:id", { preHandler: app.requireRole(["superadmin"]) }, async (req, reply) => {
    const p = req.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const before = (await pool.query(
      `SELECT fiscal_year, file_name FROM audited_reports WHERE id=$1 AND community_id=$2`,
      [id, p.cid],
    )).rows[0];
    if (!before) return reply.code(404).send({ error: "not_found" });

    await pool.query(`DELETE FROM audited_reports WHERE id=$1`, [id]);

    await audit({
      communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
      entity: "audited_report", entityId: id, action: "delete",
      before, ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
    });

    return { ok: true };
  });
}
