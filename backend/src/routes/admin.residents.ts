import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTx } from "../db";
import { audit } from "../audit";

const Body = z.object({
  email: z.string().email(),
  role: z.enum(["resident","admin","superadmin"]).default("resident"),
  flat_id: z.string().uuid().optional().nullable(),
  name: z.string().optional(),
});

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);
  app.addHook("preHandler", app.requireRole(["admin","superadmin"]));

  app.get("/", async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT a.email, a.role, a.name, a.invited_at, a.revoked_at, a.flat_id, f.code AS flat_code
       FROM allowed_emails a LEFT JOIN flats f ON f.id=a.flat_id
       WHERE a.community_id=$1
       ORDER BY a.invited_at DESC`,
      [p.cid],
    );
    return rows;
  });

  app.post("/", async (req, reply) => {
    const p = req.user;
    const body = Body.parse(req.body);
    const created = await withTx(async (c) => {
      const r = await c.query(
        `INSERT INTO allowed_emails (email, community_id, role, flat_id, name, invited_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (email) DO UPDATE SET role=EXCLUDED.role, flat_id=EXCLUDED.flat_id,
           name=EXCLUDED.name, revoked_at=NULL
         RETURNING *`,
        [body.email.toLowerCase(), p.cid, body.role, body.flat_id ?? null, body.name ?? null, p.email],
      );
      await audit({ communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "allowed_email", entityId: body.email, action: "create", after: r.rows[0] }, c);
      return r.rows[0];
    });
    return reply.code(201).send(created);
  });

  app.patch("/:email", async (req, reply) => {
    const p = req.user;
    const { email } = z.object({ email: z.string().email() }).parse(req.params);
    const body = Body.partial().parse(req.body);
    const updated = await withTx(async (c) => {
      const before = (await c.query(`SELECT * FROM allowed_emails WHERE email=$1 AND community_id=$2`,
        [email.toLowerCase(), p.cid])).rows[0];
      if (!before) return null;
      const fields: string[] = [], params: any[] = [];
      const push = (col: string, val: any) => { params.push(val); fields.push(`${col}=$${params.length}`); };
      if (body.role) push("role", body.role);
      if (body.flat_id !== undefined) push("flat_id", body.flat_id);
      if (body.name !== undefined) push("name", body.name);
      params.push(email.toLowerCase(), p.cid);
      const r = await c.query(
        `UPDATE allowed_emails SET ${fields.join(", ")} WHERE email=$${params.length-1} AND community_id=$${params.length} RETURNING *`,
        params,
      );
      await audit({ communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "allowed_email", entityId: email, action: "update", before, after: r.rows[0] }, c);
      return r.rows[0];
    });
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return updated;
  });

  app.delete("/:email", async (req, reply) => {
    const p = req.user;
    const { email } = z.object({ email: z.string().email() }).parse(req.params);
    const removed = await withTx(async (c) => {
      const r = await c.query(
        `UPDATE allowed_emails SET revoked_at=now() WHERE email=$1 AND community_id=$2 RETURNING *`,
        [email.toLowerCase(), p.cid],
      );
      if (r.rowCount === 0) return null;
      await audit({ communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "allowed_email", entityId: email, action: "delete", before: r.rows[0] }, c);
      return r.rows[0];
    });
    if (!removed) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}
