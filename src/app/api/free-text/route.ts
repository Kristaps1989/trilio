import { NextResponse } from "next/server";
import { z } from "zod";
import { db, waitlistLeads } from "@/db";
import { createCaller, freeTextLlmEnabled } from "@/services/llm/client";
import { getGroupOfSubcategory } from "@/domain/questions/catalog";
import { MAX_FREE_TEXT_LENGTH, routeFreeText } from "@/services/llm/router";
import { clientKey, createRateLimiter } from "@/services/rate-limit";

// "Kaut kas cits — pastāstīšu saviem vārdiem": routes a shopper's text to a
// subcategory. Regex first, Claude only when enabled. Rate-limited per
// client because each LLM call costs money. The text itself is stored only
// as demand data when it is out of scope (spec §2.1), never with the route.

export const dynamic = "force-dynamic";

const limiter = createRateLimiter(30, 60_000);
const caller = createCaller(db);

const Body = z.object({ text: z.string().min(1).max(MAX_FREE_TEXT_LENGTH) });

export async function POST(request: Request) {
  if (!limiter.allow(clientKey(request))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
  }
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const route = await routeFreeText(body.data.text, { caller, llmEnabled: freeTextLlmEnabled() });
  if (route.outOfScope) {
    // Demand data for choosing the next category (spec §2.1). No email yet: the waitlist form adds it.
    await db
      .insert(waitlistLeads)
      .values({ email: "", freeText: body.data.text.slice(0, MAX_FREE_TEXT_LENGTH), source: "free_text" })
      .catch(() => undefined);
  }
  return NextResponse.json(
    {
      subcategoryId: route.subcategoryId,
      groupId: route.subcategoryId ? (getGroupOfSubcategory(route.subcategoryId)?.id ?? null) : null,
      prefilled: route.prefilled,
      outOfScope: route.outOfScope,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
