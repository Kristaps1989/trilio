import { NextResponse } from "next/server";
import { z } from "zod";
import { confidenceAnswers, db } from "@/db";
import { getSubcategory } from "@/domain/questions/catalog";
import { clientKey, createRateLimiter } from "@/services/rate-limit";

// "Vai šie varianti deva pārliecību izvēlēties?" (docs/CONFIDENCE_PLAN.md §3 E):
// one anonymous answer per results view. No identity is stored.

export const dynamic = "force-dynamic";

const limiter = createRateLimiter(10, 60_000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({
  subcategoryId: z.string().min(1).max(40),
  sessionId: z.string().regex(UUID).nullable().optional(),
  confident: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

export async function POST(request: Request) {
  if (!limiter.allow(clientKey(request)))
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success || !getSubcategory(body.data.subcategoryId))
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  await db
    .insert(confidenceAnswers)
    .values({
      subcategoryId: body.data.subcategoryId,
      searchSessionId: body.data.sessionId ?? null,
      confident: body.data.confident,
      note: body.data.note || null,
    })
    // A session that no longer exists (cleaned up) still records the answer.
    .catch(() =>
      db.insert(confidenceAnswers).values({
        subcategoryId: body.data.subcategoryId,
        confident: body.data.confident,
        note: body.data.note || null,
      }),
    );
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
