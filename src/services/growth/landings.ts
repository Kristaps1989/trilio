import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adLandings } from "@/db/schema";
import { rigaDay, visitorHash } from "@/domain/analytics/visits";
import type { AdParams } from "@/domain/growth/attribution";
import { saltFor } from "@/services/visits/visits";

// Ad landings without cookies (docs/GROWTH_PLAN.md, Phase 0): the visit's
// day hash links an ad click to the shop clicks and saves of the same day,
// exactly as the visit statistics count visitors. Kept 90 days.

export const AD_LANDING_RETENTION_DAYS = 90;

type Who = { ip: string; userAgent: string | null; now?: Date };

async function hashFor(db: Db, who: Who): Promise<{ day: string; hash: string }> {
  const day = rigaDay(who.now ?? new Date());
  return { day, hash: visitorHash(await saltFor(db, day), who.ip, who.userAgent ?? "") };
}

export async function recordAdLanding(db: Db, who: Who & { path: string; params: AdParams }): Promise<void> {
  const { day, hash } = await hashFor(db, who);
  await db.insert(adLandings).values({ day, visitorHash: hash, path: who.path.slice(0, 200), ...who.params });
}

/** Today's latest ad landing of this visitor, or null. */
export async function adLandingFor(db: Db, who: Who): Promise<string | null> {
  const { day, hash } = await hashFor(db, who);
  const [row] = await db
    .select({ id: adLandings.id })
    .from(adLandings)
    .where(and(eq(adLandings.day, day), eq(adLandings.visitorHash, hash)))
    .orderBy(desc(adLandings.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function purgeAdLandings(db: Db, now = new Date()): Promise<number> {
  const cutoff = rigaDay(new Date(now.getTime() - AD_LANDING_RETENTION_DAYS * 86_400_000));
  const rows = await db.delete(adLandings).where(lt(adLandings.day, cutoff)).returning({ id: adLandings.id });
  return rows.length;
}
