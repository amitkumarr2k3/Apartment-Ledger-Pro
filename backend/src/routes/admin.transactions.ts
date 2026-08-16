import { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, refreshRollups, withTx } from "../db";
import { audit } from "../audit";

const TxnBody = z.object({
  txn_date: z.string(),                 // YYYY-MM-DD
  category_id: z.string().uuid(),
  head_id: z.string().uuid(),
  vendor_id: z.string().uuid().optional().nullable(),
  line_item_name: z.string().optional(),
  flat_id: z.string().uuid().optional().nullable(),
  amount_paise: z.number().int().nonnegative(),
  direction: z.enum(["C", "D"]),
  notes: z.string().optional(),
});

export async function routes(app: FastifyInstance) {
  app.addHook("preHandler", app.auth);
  // FIX (2026-08-15): "Transactions (CRUD)" is an Admin Controls screen --
  // plain "admin" accounts should see Admin Dashboards but not this.
  app.addHook("preHandler", app.requireRole(["superadmin"]));

  app.get("/", async (req) => {
    const p = req.user;
    const q = z.object({
      month: z.string().optional(),
      head: z.string().uuid().optional(),
      category: z.string().uuid().optional(),
      vendor: z.string().uuid().optional(),
      flat: z.string().uuid().optional(),
      direction: z.enum(["C","D"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    const params: any[] = [p.cid];
    const conds = ["t.community_id=$1"];
    const push = (sql: string, v: any) => { params.push(v); conds.push(sql.replace("$$", `$${params.length}`)); };
    if (q.month) push("t.period_month = $$::date", q.month);
    if (q.head) push("t.head_id = $$", q.head);
    if (q.category) push("t.category_id = $$", q.category);
    if (q.vendor) push("t.vendor_id = $$", q.vendor);
    if (q.flat) push("t.flat_id = $$", q.flat);
    if (q.direction) push("t.direction = $$", q.direction);

    const offset = (q.page - 1) * q.pageSize;
    const { rows } = await pool.query(
      `SELECT t.*, c.name AS category_name, h.name AS head_name, h.kind AS head_kind,
              v.name AS vendor_name, li.name AS line_item_name, f.code AS flat_code
       FROM transactions t
       JOIN heads h ON h.id=t.head_id
       JOIN categories c ON c.id=t.category_id
       LEFT JOIN vendors v ON v.id=t.vendor_id
       LEFT JOIN line_items li ON li.id=t.line_item_id
       LEFT JOIN flats f ON f.id=t.flat_id
       WHERE ${conds.join(" AND ")}
       ORDER BY t.txn_date DESC, t.created_at DESC
       LIMIT ${q.pageSize} OFFSET ${offset}`,
      params,
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM transactions t WHERE ${conds.join(" AND ")}`,
      params,
    );
    return { rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize };
  });

  app.post("/", async (req, reply) => {
    const p = req.user;
    const body = TxnBody.parse(req.body);
    const period = body.txn_date.slice(0, 7) + "-01";
    const created = await withTx(async (c) => {
      let lineItemId: string | null = null;
      if (body.line_item_name) {
        const li = await c.query(
          `INSERT INTO line_items (category_id, vendor_id, name, first_seen_month, last_seen_month)
           VALUES ($1,$2,$3,$4,$4)
           ON CONFLICT (category_id, COALESCE(vendor_id,'00000000-0000-0000-0000-000000000000'::uuid), name)
           DO UPDATE SET last_seen_month = GREATEST(line_items.last_seen_month, EXCLUDED.last_seen_month)
           RETURNING id`,
          [body.category_id, body.vendor_id ?? null, body.line_item_name, period],
        );
        lineItemId = li.rows[0].id;
      }
      const r = await c.query(
        `INSERT INTO transactions
         (community_id, txn_date, period_month, head_id, category_id, vendor_id, line_item_id,
          flat_id, amount_paise, direction, source, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$11,$12)
         RETURNING *`,
        [p.cid, body.txn_date, period, body.head_id, body.category_id, body.vendor_id ?? null,
         lineItemId, body.flat_id ?? null, body.amount_paise, body.direction, body.notes ?? null, p.sub],
      );
      await audit({
        communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "transaction", entityId: r.rows[0].id, action: "create", after: r.rows[0],
        ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
      }, c);
      return r.rows[0];
    });
    await refreshRollups();
    return reply.code(201).send(created);
  });

  app.patch("/:id", async (req, reply) => {
    const p = req.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = TxnBody.partial().parse(req.body);

    const updated = await withTx(async (c) => {
      const before = (await c.query(`SELECT * FROM transactions WHERE id=$1 AND community_id=$2`, [id, p.cid])).rows[0];
      if (!before) return null;
      const fields: string[] = [];
      const params: any[] = [];
      const push = (col: string, val: any) => { params.push(val); fields.push(`${col}=$${params.length}`); };
      if (body.txn_date) { push("txn_date", body.txn_date); push("period_month", body.txn_date.slice(0,7)+"-01"); }
      if (body.category_id) push("category_id", body.category_id);
      if (body.head_id) push("head_id", body.head_id);
      if (body.vendor_id !== undefined) push("vendor_id", body.vendor_id);
      if (body.flat_id !== undefined) push("flat_id", body.flat_id);
      if (body.amount_paise !== undefined) push("amount_paise", body.amount_paise);
      if (body.direction) push("direction", body.direction);
      if (body.notes !== undefined) push("notes", body.notes);
      fields.push(`updated_at=now()`);
      params.push(id, p.cid);
      const r = await c.query(
        `UPDATE transactions SET ${fields.join(", ")}
         WHERE id=$${params.length-1} AND community_id=$${params.length} RETURNING *`,
        params,
      );
      await audit({
        communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "transaction", entityId: id, action: "update",
        before, after: r.rows[0], ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
      }, c);
      return r.rows[0];
    });
    if (!updated) return reply.code(404).send({ error: "not_found" });
    await refreshRollups();
    return updated;
  });

  app.delete("/:id", async (req, reply) => {
    const p = req.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const removed = await withTx(async (c) => {
      const before = (await c.query(`SELECT * FROM transactions WHERE id=$1 AND community_id=$2`, [id, p.cid])).rows[0];
      if (!before) return null;
      await c.query(`DELETE FROM transactions WHERE id=$1`, [id]);
      await audit({
        communityId: p.cid, actorUserId: p.sub, actorEmail: p.email,
        entity: "transaction", entityId: id, action: "delete", before,
        ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
      }, c);
      return before;
    });
    if (!removed) return reply.code(404).send({ error: "not_found" });
    await refreshRollups();
    return { ok: true };
  });
}
