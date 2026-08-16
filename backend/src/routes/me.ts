import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTx } from "../db";
import { audit } from "../audit";

export async function routes(app: FastifyInstance) {
  app.get("/me", { preHandler: app.auth }, async (req) => {
    const p = req.user;
    const ds = await pool.query(
      `SELECT dashboard_key, enabled, hidden_widgets FROM dashboard_settings WHERE community_id=$1`,
      [p.cid],
    );
    return {
      user: { id: p.sub, email: p.email, roles: p.roles, communityId: p.cid },
      dashboards: ds.rows,
    };
  });

  // FIX (2026-08-15): self-service profile update. Lets the current user --
  // including the bootstrap superadmin -- change their own name/email,
  // instead of the account's email being effectively hardcoded forever via
  // SUPERADMIN_EMAIL (see auth.ts). Roles are untouched by this: user_roles
  // is keyed by user_id, not email (confirmed in seed.js), so changing the
  // email here never affects what the account is allowed to do.
  const PatchMeBody = z.object({
    email: z.string().email().optional(),
    name: z.string().min(1).optional(),
  });

  app.patch("/me", { preHandler: app.auth }, async (req, reply) => {
    const p = req.user;
    const body = PatchMeBody.parse(req.body);
    if (!body.email && !body.name) {
      return reply.code(400).send({ error: "nothing_to_update" });
    }
    const newEmail = body.email?.toLowerCase();

    try {
      const updated = await withTx(async (c) => {
        const before = (await c.query(`SELECT id, email, name FROM users WHERE id=$1`, [p.sub])).rows[0];
        if (!before) return null;
        const emailChanging = !!newEmail && newEmail !== before.email.toLowerCase();

        if (emailChanging) {
          // Enforce uniqueness ourselves so we return a clean 409 instead of
          // a raw DB constraint violation bubbling up as a 500.
          const clash = await c.query(`SELECT id FROM users WHERE email=$1 AND id<>$2`, [newEmail, p.sub]);
          if (clash.rowCount) {
            throw Object.assign(new Error("email_taken"), { statusCode: 409 });
          }
        }

        const fields: string[] = [];
        const params: any[] = [];
        const push = (col: string, val: any) => { params.push(val); fields.push(`${col}=$${params.length}`); };
        if (emailChanging) push("email", newEmail);
        if (body.name) push("name", body.name);
        params.push(p.sub);

        const r = await c.query(
          `UPDATE users SET ${fields.join(", ")} WHERE id=$${params.length} RETURNING id, email, name`,
          params,
        );

        // Keep the whitelist gate in sync -- allowed_emails is keyed by
        // email (not user_id), so an email change must be mirrored there
        // too, or this account would fall off its own whitelist entry.
        if (emailChanging) {
          await c.query(
            `UPDATE allowed_emails SET email=$1, name=COALESCE($2, name) WHERE email=$3 AND community_id=$4`,
            [newEmail, body.name ?? null, before.email.toLowerCase(), p.cid],
          );
        } else if (body.name) {
          await c.query(
            `UPDATE allowed_emails SET name=$1 WHERE email=$2 AND community_id=$3`,
            [body.name, before.email.toLowerCase(), p.cid],
          );
        }

        await audit({
          communityId: p.cid, actorUserId: p.sub, actorEmail: before.email,
          entity: "user", entityId: p.sub, action: "update",
          before, after: r.rows[0],
        }, c);

        return r.rows[0];
      });

      if (!updated) return reply.code(404).send({ error: "not_found" });

      // Re-issue the JWT so req.user.email (and anything reading it, e.g.
      // audit logs, admin.residents.ts checks) reflects the new email
      // immediately -- no forced re-login needed after an email change.
      const token = await reply.jwtSign({ sub: p.sub, email: updated.email, roles: p.roles, cid: p.cid });

      return {
        user: { id: updated.id, email: updated.email, name: updated.name, roles: p.roles, communityId: p.cid },
        token,
      };
    } catch (e: any) {
      if (e?.statusCode === 409) return reply.code(409).send({ error: "email_taken" });
      throw e;
    }
  });
}
