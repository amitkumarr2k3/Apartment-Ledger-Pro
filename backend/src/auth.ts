import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fjwt from "@fastify/jwt";
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
const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "false").toLowerCase() !== "false";
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || "admin@example.com").toLowerCase();

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
  await app.register(fjwt, { secret: process.env.JWT_SECRET || "dev-secret" });

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
