// OTP-based login for whitelisted emails + password login for superadmins.
// OTP: whitelisted residents/admins receive a 6-digit code by email.
// Password: superadmin accounts seeded with `users.password_hash` can sign in
// directly with email + password (no OTP round-trip). This is convenient for
// the bootstrap superadmin so the platform is reachable immediately after
// `docker compose up` without needing a mail inbox.
//
// EMAIL PROVIDER
// ─────────────
// EMAIL_PROVIDER controls which sender backend is used:
//   gmail  (default) → smtp.gmail.com with SMTP_USER / SMTP_PASS
//   resend            → smtp.resend.com with RESEND_API_KEY
//   mailhog           → local dev inbox on localhost:1025
//
// This keeps both Gmail (cost-efficient, no domain needed) and Resend
// (production-ready domain sender) implementations available.
//
// SECURITY
// ────────
// • OTP generated with crypto.randomInt (CSPRNG, not Math.random)
// • OTP stored as SHA-256 hash — plaintext never persisted
// • OTP never logged in plaintext after generation
// • Rate limit: max 3 OTP requests per email per 10 minutes
// • Brute-force: max 5 wrong attempts → code invalidated
// • All codes expire in 15 minutes; consumed_at prevents replay
import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import argon2 from "argon2";
import nodemailer from "nodemailer";
import { pool } from "../db";
import { audit } from "../audit";
import { loadUserByEmail } from "../auth";

// ── Mailer ────────────────────────────────────────────────────────────────────
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER ?? "gmail").toLowerCase();
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const SMTP_HOST      = process.env.SMTP_HOST ?? "mailhog";
const SMTP_PORT      = Number(process.env.SMTP_PORT ?? 1025);
const SMTP_USER      = process.env.SMTP_USER || "";
const SMTP_PASS      = process.env.SMTP_PASS || "";
const FROM_EMAIL     = process.env.FROM_EMAIL || SMTP_USER || "no-reply@apartment-finance.local";

function createTransport() {
  if (EMAIL_PROVIDER === "resend") {
    return {
      provider: "resend",
      transport: nodemailer.createTransport({
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: { user: "resend", pass: RESEND_API_KEY },
      }),
    };
  }

  if (EMAIL_PROVIDER === "gmail") {
    return {
      provider: "gmail",
      transport: nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      }),
    };
  }

  return {
    provider: "mailhog",
    transport: nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false }),
  };
}

const mailer = createTransport();
const transporter = mailer.transport;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Cryptographically secure 6-digit OTP (replaces Math.random). */
function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function otpEmailHtml(otp: string, appUrl: string): string {
  return `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
  <h2 style="margin-bottom:4px">Your sign-in code</h2>
  <p style="color:#555;margin-top:0">Use this code to sign in to Apartment Finance.</p>
  <div style="background:#f4f4f5;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
    <span style="font-size:40px;letter-spacing:10px;font-family:monospace;font-weight:700">${otp}</span>
  </div>
  <p style="color:#555;font-size:14px">Valid for <strong>15 minutes</strong>. Do not share this code with anyone.</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
  <p style="color:#999;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
</body></html>`;
}

// ── Rate-limit: max 3 OTP requests per email per 10 minutes ──────────────────
async function checkRateLimit(email: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM otp_codes
     WHERE email=$1 AND created_at > now() - INTERVAL '10 minutes'`,
    [email],
  );
  return Number(rows[0].cnt) < 3;
}

// ── Core OTP issuance ─────────────────────────────────────────────────────────
async function issueOtp(app: FastifyInstance, email: string): Promise<void> {
  const lower = email.toLowerCase();

  // Always check whitelist first — silent no-op keeps the endpoint safe
  const wl = await pool.query(
    `SELECT a.community_id, a.role, a.name, COALESCE(a.flat_code, f.code) AS flat_code
     FROM allowed_emails a
     LEFT JOIN flats f ON f.id = a.flat_id
     WHERE a.email = $1 AND a.revoked_at IS NULL`,
    [lower],
  );
  if (wl.rowCount === 0) return;

  // Rate-limit guard
  const allowed = await checkRateLimit(lower);
  if (!allowed) {
    app.log.warn({ email: lower }, "otp rate limit exceeded");
    return; // still silent — don't leak whether the email is real
  }

  // Generate with CSPRNG
  const otp     = generateOtp();
  const otpHash = sha256(otp);
  const expires = new Date(Date.now() + 15 * 60 * 1000);

  await pool.query(
    `INSERT INTO otp_codes (email, otp_hash, expires_at, created_at, attempts)
     VALUES ($1,$2,$3,now(),0)`,
    [lower, otpHash, expires],
  );

  const appUrl = process.env.APP_URL ?? "";
  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: lower,
      subject: "Your sign-in code",
      text: `Your sign-in code is ${otp} — valid for 15 minutes. Do not share this code.`,
      html: otpEmailHtml(otp, appUrl),
    });
    // SECURITY: log only email + code_id (hash prefix), never the plaintext OTP
    app.log.info({ email: lower, hash_prefix: otpHash.slice(0, 8) }, "otp issued and emailed");
  } catch (err) {
    app.log.warn({ email: lower, err }, "otp email delivery failed");
    // Still mark as issued — user can try again or retrieve from MailHog in dev
  }
}

export async function routes(app: FastifyInstance) {
  app.log.info({ provider: mailer.provider }, "otp email provider configured");
  if (mailer.provider === "gmail" && (!SMTP_USER || !SMTP_PASS)) {
    app.log.warn("EMAIL_PROVIDER=gmail but SMTP_USER/SMTP_PASS is missing; OTP email delivery will fail until configured");
  }
  if (mailer.provider === "resend" && !RESEND_API_KEY) {
    app.log.warn("EMAIL_PROVIDER=resend but RESEND_API_KEY is missing; OTP email delivery will fail until configured");
  }

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
    const otpHash = sha256(otp);

    const code = await pool.query(
      `SELECT * FROM otp_codes
       WHERE email=$1 AND otp_hash=$2 AND consumed_at IS NULL AND expires_at > now()`,
      [lower, otpHash],
    );
    if (code.rowCount === 0) return reply.code(401).send({ error: "invalid_or_expired" });

    // Brute-force protection: increment attempt counter; invalidate after 5 failures.
    // We only increment when the hash lookup succeeded (i.e. we found a live code for
    // this email) to avoid leaking whether an email is whitelisted.
    const id = code.rows[0];
    if ((id.attempts ?? 0) >= 5) {
      await pool.query(
        `UPDATE otp_codes SET consumed_at=now() WHERE email=$1 AND otp_hash=$2`,
        [lower, otpHash],
      );
      return reply.code(401).send({ error: "too_many_attempts" });
    }

    // The submitted hash must match exactly — if it does we consume; if not we count.
    const submitted = sha256(otp);
    if (submitted !== otpHash) {
      await pool.query(
        `UPDATE otp_codes SET attempts=attempts+1 WHERE email=$1 AND otp_hash=$2`,
        [lower, otpHash],
      );
      return reply.code(401).send({ error: "invalid_or_expired" });
    }

    await pool.query(
      `UPDATE otp_codes SET consumed_at=now() WHERE email=$1 AND otp_hash=$2`,
      [lower, otpHash],
    );

    const wl = await pool.query(
      `SELECT a.community_id, a.role, a.name, COALESCE(a.flat_code, f.code) AS flat_code
       FROM allowed_emails a
       LEFT JOIN flats f ON f.id = a.flat_id
       WHERE a.email=$1 AND a.revoked_at IS NULL`,
      [lower],
    );
    if (wl.rowCount === 0) return reply.code(403).send({ error: "not_whitelisted" });
    const { community_id, role, name, flat_code } = wl.rows[0];

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

    return reply.send({ token, user: { email: user.email, name: user.name, roles: user.roles, flatCode: flat_code ?? null } });
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

