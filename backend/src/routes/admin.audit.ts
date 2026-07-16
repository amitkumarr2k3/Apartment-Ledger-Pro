import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);
  app.addHook("preHandler", app.requireRole(["admin","superadmin"]));

  app.get("/", async (req) => {
    const p = req.user;
    const q = z.object({
      entity: z.string().optional(),
      actor: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const params: any[] = [p.cid];
    const conds = ["community_id=$1"];
    const push = (sql: string, v: any) => { params.push(v); conds.push(sql.replace("$$", `$${params.length}`)); };
    if (q.entity) push("entity=$$", q.entity);
    if (q.actor) push("actor_email=$$", q.actor);
    if (q.from) push("at >= $$::timestamptz", q.from);
    if (q.to) push("at <= $$::timestamptz", q.to);
    const offset = (q.page - 1) * q.pageSize;
    const { rows } = await pool.query(
      `SELECT id, actor_email, entity, entity_id, action, before, after, at, ip
       FROM audit_log WHERE ${conds.join(" AND ")}
       ORDER BY at DESC LIMIT ${q.pageSize} OFFSET ${offset}`, params,
    );
    return { rows, page: q.page, pageSize: q.pageSize };
  });
}
