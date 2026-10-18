import { lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { waitlistLeads } from "@/db/schema";

/** Privacy policy: waitlist e-mails and request texts are kept at most 12 months. */
export const WAITLIST_RETENTION_DAYS = 365;

export async function purgeOldWaitlistLeads(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - WAITLIST_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .delete(waitlistLeads)
    .where(lt(waitlistLeads.createdAt, cutoff))
    .returning({ id: waitlistLeads.id });
  return rows.length;
}
