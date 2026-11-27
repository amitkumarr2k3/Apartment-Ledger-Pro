import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";

const readQuery = z.object({ chartKey: z.string().trim().min(1).max(500) });
const saveBody = z.object({
  chartKey: z.string().trim().min(1).max(500),
  pointKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  comment: z.string().trim().min(1).max(4000),
  visibility: z.enum(["all", "resident", "admin"]),
});

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);

  app.get("/", async (req, reply) => {
    const parsed = readQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    const { chartKey } = parsed.data;
    const roles = req.user.roles;
    const isSuperAdmin = roles.includes("superadmin");
    const visibility = isSuperAdmin
      ? undefined
      : roles.includes("admin")
        ? "admin"
        : "resident";

    const { rows } = visibility
      ? await pool.query(
          `SELECT id, chart_key, point_key, title, comment, visibility, created_at, updated_at
           FROM chart_annotations
           WHERE community_id = $1 AND chart_key = $2
             AND (visibility = 'all' OR visibility = $3)
           ORDER BY point_key`,
          [req.user.cid, chartKey, visibility],
        )
      : await pool.query(
          `SELECT id, chart_key, point_key, title, comment, visibility, created_at, updated_at
           FROM chart_annotations
           WHERE community_id = $1 AND chart_key = $2
           ORDER BY point_key`,
          [req.user.cid, chartKey],
        );
    return { rows };
  });

  app.put("/", { preHandler: app.requireRole(["superadmin"]) }, async (req, reply) => {
    const parsed = saveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_annotation", details: parsed.error.flatten() });
    const input = parsed.data;
    const { rows } = await pool.query(
      `INSERT INTO chart_annotations
         (community_id, chart_key, point_key, title, comment, visibility, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (community_id, chart_key, point_key)
       DO UPDATE SET title = EXCLUDED.title,
                     comment = EXCLUDED.comment,
                     visibility = EXCLUDED.visibility,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()
       RETURNING id, chart_key, point_key, title, comment, visibility, created_at, updated_at`,
      [req.user.cid, input.chartKey, input.pointKey, input.title, input.comment, input.visibility, req.user.sub],
    );
    return rows[0];
  });

  app.delete("/", { preHandler: app.requireRole(["superadmin"]) }, async (req, reply) => {
    const parsed = z.object({
      chartKey: z.string().trim().min(1).max(500),
      pointKey: z.string().trim().min(1).max(120),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_annotation_key", details: parsed.error.flatten() });
    const input = parsed.data;
    const result = await pool.query(
      `DELETE FROM chart_annotations WHERE community_id = $1 AND chart_key = $2 AND point_key = $3`,
      [req.user.cid, input.chartKey, input.pointKey],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "annotation_not_found" });
    return { deleted: true };
  });
}
