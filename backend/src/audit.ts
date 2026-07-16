import { pool } from "./db";
import type { PoolClient } from "pg";

export type AuditInput = {
  communityId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  entity: string;
  entityId?: string | null;
  action: "create" | "update" | "delete" | "login" | "import" | "settings";
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

export async function audit(input: AuditInput, client: PoolClient | typeof pool = pool) {
  await client.query(
    `INSERT INTO audit_log
     (community_id, actor_user_id, actor_email, entity, entity_id, action, before, after, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.communityId ?? null,
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      input.entity,
      input.entityId ?? null,
      input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.ip ?? null,
      input.userAgent ?? null,
    ],
  );
}
