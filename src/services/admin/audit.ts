import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adminAudit, appFlags } from "@/db/schema";

// The admin's trail (docs/ADMIN_AND_OFFERS_PLAN.md §2.2): every write in /admin
// is one row. Read-only pages are not logged.

export type AuditEntry = {
  adminEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
};

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(adminAudit).values({
    adminEmail: entry.adminEmail,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? null,
    ip: entry.ip ?? null,
  });
}

export async function recentAudit(db: Db, limit = 50) {
  return db.select().from(adminAudit).orderBy(desc(adminAudit.createdAt)).limit(limit);
}

// Runtime switches.

/** "Apturēt visus piedāvājumu e-pastus": honoured by every offer sender. */
export const OFFERS_PAUSED = "offers_paused";

export async function getFlag(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(appFlags).where(eq(appFlags.key, key));
  return row?.value ?? null;
}

export async function setFlag(db: Db, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.delete(appFlags).where(eq(appFlags.key, key));
    return;
  }
  await db
    .insert(appFlags)
    .values({ key, value })
    .onConflictDoUpdate({ target: appFlags.key, set: { value, updatedAt: new Date() } });
}

export async function offersPaused(db: Db): Promise<boolean> {
  return (await getFlag(db, OFFERS_PAUSED)) === "1";
}
