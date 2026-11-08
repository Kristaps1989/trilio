import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { searchSessions } from "@/db/schema";
import { rigaDay, visitorHash } from "@/domain/analytics/visits";
import { saltFor } from "./visits";

// One search session per visitor and search (docs/CLICK_QUALITY_PLAN.md §3):
// the results page is rendered again on every filter change, reload, back and
// forward. The same visitor (the day's anonymous hash) asking the same thing
// within 30 minutes reuses the session, so "Meklējumi" counts searches, not renders.

export const SEARCH_SESSION_REUSE_MS = 30 * 60 * 1000;

export async function searchSessionFor(
  db: Db,
  input: {
    ip: string;
    userAgent: string | null;
    subcategoryId: string;
    answers: Record<string, unknown>;
    budgetCents: number | null;
    now?: Date;
    /** judgeRequest's verdict: a suspect or admin search is kept, marked, and left out. */
    suspect?: string | null;
  },
): Promise<string | null> {
  const now = input.now ?? new Date();
  const hash = visitorHash(await saltFor(db, rigaDay(now)), input.ip, input.userAgent ?? "");
  const [recent] = await db
    .select({ id: searchSessions.id })
    .from(searchSessions)
    .where(
      and(
        eq(searchSessions.visitorHash, hash),
        eq(searchSessions.subcategoryId, input.subcategoryId),
        gte(searchSessions.createdAt, new Date(now.getTime() - SEARCH_SESSION_REUSE_MS)),
        sql`${searchSessions.answers} = ${JSON.stringify(input.answers)}::jsonb`,
      ),
    )
    .orderBy(desc(searchSessions.createdAt))
    .limit(1);
  if (recent) return recent.id;
  const [row] = await db
    .insert(searchSessions)
    .values({
      subcategoryId: input.subcategoryId,
      answers: input.answers,
      budgetCents: input.budgetCents,
      visitorHash: hash,
      suspect: input.suspect ?? null,
      createdAt: now,
    })
    .returning({ id: searchSessions.id });
  return row?.id ?? null;
}
