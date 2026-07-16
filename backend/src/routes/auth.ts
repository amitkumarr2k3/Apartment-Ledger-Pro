// OTP-based login for whitelisted emails + password login for superadmins.
// OTP: whitelisted residents/admins receive a 6-digit code by email.
// Password: superadmin accounts seeded with `users.password_hash` can sign in
// directly with email + password (no OTP round-trip). This is convenient for
// the bootstrap superadmin so the platform is reachable immediately after
// `docker compose up` without needing a mail inbox.
import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import argon2 from "argon2";
import nodemailer from "nodemailer";
import { pool } from "../db";
import { audit } from "../audit";
import { loadUserByEmail } from "../auth";


const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mailhog",
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
});

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function issueOtp(app: FastifyInstance, email: string) {
  const lower = email.toLowerCase();
  const wl = await pool.query(
    `SELECT community_id, role, name FROM allowed_emails
     WHERE email = $1 AND revoked_at IS NULL`,
    [lower],
  );
  if (wl.rowCount === 0) return; // silent no-op for non-whitelisted / revoked

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = hash(otp);
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await pool.query(
    `INSERT INTO otp_codes (email, otp_hash, expires_at) VALUES ($1,$2,$3)`,
    [lower, otpHash, expires],
  );

  await transporter.sendMail({
    from: "no-reply@apartment-finance.local",
    to: lower,
    subject: "Your login code",
    text: `Your OTP is ${otp} (valid 15 minutes). Do not share this code.`,
  }).catch((e) => app.log.warn({ e }, "email send failed (dev)"));

  app.log.info({ email: lower, otp }, "otp issued");
}

export async function routes(app: FastifyInstance) {
  // Canonical endpoint
  app.post("/request-otp", async (req, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await issueOtp(app, email);
    return reply.send({ ok: true });
  });

  // Backwards-compatible alias for any client still calling the old path.
  app.post("/request-magic-link", async (req, reply) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await issueOtp(app, email);
    return reply.send({ ok: true });
  });

  app.post("/verify-otp", async (req, reply) => {
    const { email, otp } = z.object({
      email: z.string().email(),
      otp: z.string().length(6),
    }).parse(req.body);
    const lower = email.toLowerCase();
    const otpHash = hash(otp);

    const code = await pool.query(
      `SELECT * FROM otp_codes
       WHERE email=$1 AND otp_hash=$2 AND consumed_at IS NULL AND expires_at > now()`,
      [lower, otpHash],
    );
    if (code.rowCount === 0) return reply.code(401).send({ error: "invalid_or_expired" });

    await pool.query(
      `UPDATE otp_codes SET consumed_at=now() WHERE email=$1 AND otp_hash=$2`,
      [lower, otpHash],
    );

    const wl = await pool.query(
      `SELECT community_id, role, name FROM allowed_emails
       WHERE email=$1 AND revoked_at IS NULL`,
      [lower],
    );
    if (wl.rowCount === 0) return reply.code(403).send({ error: "not_whitelisted" });
    const { community_id, role, name } = wl.rows[0];

    const u = await pool.query(
      `INSERT INTO users (community_id, email, name, last_login_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (email) DO UPDATE SET last_login_at=now()
       RETURNING id`,
      [community_id, lower, name],
    );
    const userId = u.rows[0].id;
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [userId, role],
    );

    const user = await loadUserByEmail(lower);
    const token = await reply.jwtSign({
      sub: user.id, email: user.email, roles: user.roles, cid: user.community_id,
    }, { expiresIn: "12h" });

    await audit({
      communityId: user.community_id, actorUserId: user.id, actorEmail: user.email,
      entity: "auth", action: "login",
      ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
    });

    return reply.send({ token, user: { email: user.email, name: user.name, roles: user.roles } });
  });

  // Password login — for the bootstrap superadmin (and any user with a
  // password_hash). Prefer OTP for regular residents.
  app.post("/login-password", async (req, reply) => {
    const { email, password } = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(req.body);
    const lower = email.toLowerCase();

    const q = await pool.query(
      `SELECT id, community_id, email, name, password_hash FROM users WHERE email=$1`,
      [lower],
    );
    if (q.rowCount === 0 || !q.rows[0].password_hash) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const row = q.rows[0];
    let ok = false;
    try { ok = await argon2.verify(row.password_hash, password); } catch { ok = false; }
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    await pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [row.id]);

    // Self-heal: password-login users are superadmins by definition; make sure
    // their user_roles has both 'superadmin' and 'admin' so the frontend RBAC
    // maps them to the admin persona even if a previous seed run missed a row.
    await pool.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,'superadmin'),($1,'admin')
       ON CONFLICT DO NOTHING`,
      [row.id],
    );

    // Self-heal: ensure users.community_id points at an existing community.
    // A prior --full cleanup can wipe communities and leave the superadmin
    // orphaned, which then causes FK violations on any community-scoped write
    // (e.g. import_batches_community_id_fkey during CSV import).
    let cid: string | null = row.community_id;
    if (cid) {
      const chk = await pool.query(`SELECT 1 FROM communities WHERE id=$1`, [cid]);
      if (chk.rowCount === 0) cid = null;
    }
    if (!cid) {
      const existing = await pool.query(`SELECT id FROM communities ORDER BY created_at LIMIT 1`);
      if (existing.rowCount && existing.rows[0]?.id) {
        cid = existing.rows[0].id;
      } else {
        const ins = await pool.query(
          `INSERT INTO communities (name, tz, currency) VALUES ('Default Community','Asia/Kolkata','INR') RETURNING id`,
        );
        cid = ins.rows[0].id;
      }
      await pool.query(`UPDATE users SET community_id=$1 WHERE id=$2`, [cid, row.id]);
    }

    const user = await loadUserByEmail(lower);
    const token = await reply.jwtSign({
      sub: user.id, email: user.email, roles: user.roles, cid: user.community_id,
    }, { expiresIn: "12h" });

    await audit({
      communityId: user.community_id, actorUserId: user.id, actorEmail: user.email,
      entity: "auth", action: "login",
      ip: req.ip, userAgent: req.headers["user-agent"] ?? null,
    });

    return reply.send({ token, user: { email: user.email, name: user.name, roles: user.roles } });
  });

  // Legacy alias
  app.post("/verify", async (req, reply) => {
    (req as any).routerPath = "/verify-otp";
    return app.inject({ method: "POST", url: "/api/auth/verify-otp", payload: req.body as any })
      .then((r) => reply.code(r.statusCode).headers(r.headers as any).send(r.payload));
  });
}

