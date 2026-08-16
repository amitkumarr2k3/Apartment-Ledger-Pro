import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTx } from "../db";
import { audit } from "../audit";

const Body = z.object({
  email: z.string().email(),
  role: z.enum(["resident","admin","superadmin"]).default("resident"),
  flat_id: z.string().uuid().optional().nullable(),
  flat_code: z.string().optional().nullable(),
  name: z.string().optional(),
});

const PatchBody = z.object({
  role: z.enum(["resident","admin","superadmin"]).optional(),
  flat_id: z.string().uuid().optional().nullable(),
  flat_code: z.string().optional().nullable(),
  name: z.string().optional(),
  // Pass revoke: true to revoke, revoke: false to reactivate
  revoke: z.boolean().optional(),
});

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);
  // FIX (2026-08-15): "Residents & Whitelist" is an Admin Controls screen --
  // plain "admin" accounts should see Admin Dashboards but NOT Admin
  // Controls. Only superadmin manages residents and role assignments now.
  app.addHook("preHandler", app.requireRole(["superadmin"]));

  app.get("/", async (req) => {
    const p = req.user;
    const { rows } = await pool.query(
      `SELECT a.email, a.role, a.name, a.flat_code, a.invited_at, a.revoked_at, a.flat_id, f.code AS flat_code_join
       FROM allowed_emails a LEFT JOIN flats f ON f.id=a.flat_id
       WHERE a.community_id=$1
       ORDER BY a.invited_at DESC`,
      [p.cid],
    );
    // Prefer explicit flat_code text column; fall back to flats join code
    return rows.map((r) => ({ ...r, flat_code: r.flat_code ?? r.flat_code_join ?? null }));
  });

  app.post("/", async (req, reply) => {
    const p = req.user;
    const body = Body.parse(req.body);
    // Defense-in-depth: even though the route above is already
    // superadmin-only, this stops a future loosening of that guard from
    // silently allowing role escalation to superadmin too.
    if (body.role === "superadmin" && !p.roles.includes("superadmin")) {
      return reply.code(403).send({ error: "only_superadmin_can_grant_superadmin" });
    }
    const created = await withTx(async (c) => {
      const r = await c.query(
        `INSERT INTO allowed_emails (email, community_id, role, flat_id, flat_code, name, invited_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (email) DO UPDATE SET role=EXCLUDED.role, flat_id=EXCLUDED.flat_id,
           flat_code=EXCLUDED.flat_code, name=EXCLUDED.name, revoked_at=NULL
         RETURNING *`,
        [body.email.toLowerCase(), p.cid, body.role, body.flat_id ?? null, body.flat_code ?? null, body.name ?? null, p.email],
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
    const body = PatchBody.parse(req.body);
    if (body.role === "superadmin" && !p.roles.includes("superadmin")) {
      return reply.code(403).send({ error: "only_superadmin_can_grant_superadmin" });
    }
    const updated = await withTx(async (c) => {
      const before = (await c.query(`SELECT * FROM allowed_emails WHERE email=$1 AND community_id=$2`,
        [email.toLowerCase(), p.cid])).rows[0];
      if (!before) return null;
      const fields: string[] = [], params: any[] = [];
      const push = (col: string, val: any) => { params.push(val); fields.push(`${col}=$${params.length}`); };
      if (body.role) push("role", body.role);
      if (body.flat_id !== undefined) push("flat_id", body.flat_id);
      if (body.flat_code !== undefined) push("flat_code", body.flat_code);
      if (body.name !== undefined) push("name", body.name);
      if (body.revoke === true) push("revoked_at", new Date().toISOString());
      if (body.revoke === false) push("revoked_at", null);
      if (fields.length === 0) return before;
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
