import { NextResponse } from "next/server";
import { z } from "zod";
import { db, waitlistLeads } from "@/db";
import { clientKey, createRateLimiter } from "@/services/rate-limit";

// Out-of-scope requests leave an email (spec §2.1): demand data for the next category.

export const dynamic = "force-dynamic";

const limiter = createRateLimiter(5, 60_000);
const Body = z.object({
  email: z.string().trim().email().max(254),
  freeText: z.string().trim().max(300).optional(),
  source: z.enum(["free_text", "radar_waitlist"]).default("free_text"),
});

export async function POST(request: Request) {
  if (!limiter.allow(clientKey(request)))
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await db.insert(waitlistLeads).values({
    email: body.data.email.toLowerCase(),
    freeText: body.data.freeText ?? null,
    source: body.data.source,
  });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
