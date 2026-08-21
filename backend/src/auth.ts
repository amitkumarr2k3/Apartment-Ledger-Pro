import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fjwt from "@fastify/jwt";
import fCookie from "@fastify/cookie";
import { pool } from "./db";

export type JwtPayload = {
  sub: string;        // user id
  email: string;
  roles: string[];
  cid: string;        // community id
};

// AUTH_ENABLED=false → prototype mode: skip JWT verify and inject the
// SUPERADMIN identity so the UI (which also bypasses login when its own
// AUTH_ENABLED flag is false) can call protected endpoints without a token.
// SECURITY: fail CLOSED, not open. A missing AUTH_ENABLED env var now
// defaults to auth REQUIRED -- the old default of "false" meant a
// missing env var silently disabled all authentication.
const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "true").toLowerCase() !== "false";
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || "admin@example.com").toLowerCase();

// SECURITY: the cookie's Secure flag is now an EXPLICIT toggle, not tied to
// NODE_ENV. Reason: NODE_ENV=production commonly gets set for perf/logging
// reasons well before a real HTTPS domain is in place (exactly what
// happened here -- production mode on a bare-IP HTTP deployment). If Secure
// tracked NODE_ENV, the browser would silently discard the cookie on any
// insecure origin, and every authenticated request 401s with no obvious
// cause. Default is "false" so a fresh deploy isn't broken by default --
// set COOKIE_SECURE=true in your environment the moment you're actually
// serving over HTTPS, and leave it true from then on.
const COOKIE_SECURE = (process.env.COOKIE_SECURE ?? "false").toLowerCase() === "true";

// FIX (2026-08-15): removed. This used to force-inject "superadmin"+"admin"
// onto any JWT whose email matched SUPERADMIN_EMAIL, on every request --
// regardless of the database. That meant (a) that account's email was
// effectively hardcoded forever, and (b) you could never actually revoke
// superadmin from it via the DB, since this override re-granted it anyway.
// seed.js already writes a durable (user_id, 'superadmin') row into
// user_roles at bootstrap, and loadUserByEmail() aggregates real roles from
// that table -- so the JWT issued at login already carries correct roles
// for every account, including the bootstrap superadmin. The account's
// email can now be changed freely (see routes/me.ts) without affecting role.
function normaliseJwtUser(user: JwtPayload | undefined): JwtPayload | undefined {
  return user;
}

let cachedGuest: JwtPayload | null = null;
async function getGuestIdentity(): Promise<JwtPayload | null> {
  if (cachedGuest) return cachedGuest;
  const email = SUPERADMIN_EMAIL;
  const u = await loadUserByEmail(email);
  if (!u) return null;
  cachedGuest = {
    sub: u.id,
    email: u.email,
    cid: u.community_id,
    roles: (u.roles && u.roles.length ? u.roles : ["superadmin", "admin"]),
  };
  return cachedGuest;
}

export async function registerAuth(app: FastifyInstance) {
  // SECURITY: no fallback secret -- docker-compose.yml previously shipped
  // the literal placeholder "dev-jwt-secret-change-me" as the real secret.
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is not set. Refusing to start with an insecure default -- " +
      "set JWT_SECRET in your environment (generate one with: openssl rand -hex 32).",
    );
  }
  await app.register(fCookie);
  await app.register(fjwt, {
    secret: process.env.JWT_SECRET,
    cookie: { cookieName: "apf_token", signed: false },
  });

  app.decorate("auth", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!AUTH_ENABLED) {
      const g = await getGuestIdentity();
      if (g) { (req as any).user = g; return; }
      // fall through to JWT verify if no seeded superadmin yet
    }
    try {
      await req.jwtVerify();
      (req as any).user = normaliseJwtUser((req as any).user);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.decorate("requireRole", (roles: string[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const p = req.user as JwtPayload | undefined;
      if (!p) return reply.code(401).send({ error: "unauthorized" });
      if (!p.roles.some((r) => roles.includes(r))) {
        return reply.code(403).send({ error: "forbidden" });
      }
    };
  });
}

// Shared cookie config for every place that issues or re-issues the auth
// token: routes/auth.ts's /verify-otp and /login-password, and routes/me.ts's
// re-issue after an email change. Keeping httpOnly/secure/sameSite/maxAge in
// ONE place means they can't silently drift apart across call sites.
export function setAuthCookie(reply: FastifyReply, token: string) {
  reply.setCookie("apf_token", token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 60 * 60, // 12h -- keep in sync with the JWT's own expiresIn
  });
}

export async function loadUserByEmail(email: string) {
  // FIX (2026-08-15): user_roles.role is a Postgres ENUM, not plain text.
  // node-postgres has a built-in array parser for well-known types like
  // text[], but not for arrays of custom enum types -- so without an
  // explicit ::text[] cast, this query silently returned the raw Postgres
  // array-literal STRING "{superadmin,admin}" instead of a real JS array
  // ["superadmin","admin"]. Every `Array.isArray(roles)` check on the
  // frontend then failed and fell back to [], resolving role to "resident"
  // no matter what was actually in the database. Casting each role to text
  // before aggregating fixes this at the source.
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.community_id, u.name,
            COALESCE(array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}'::text[]) AS roles
     FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
     WHERE u.email = $1
     GROUP BY u.id`,
    [email.toLowerCase()],
  );
  return rows[0];
}

declare module "fastify" {
  interface FastifyInstance {
    auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (roles: string[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
