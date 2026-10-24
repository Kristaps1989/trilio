import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { isBot } from "@/domain/analytics/visits";
import { recordVisit } from "@/services/visits/visits";
import { adParams } from "@/domain/growth/attribution";
import { recordAdLanding } from "@/services/growth/landings";
import { clientKey, createRateLimiter } from "@/services/rate-limit";

// First-party page views without cookies (docs/ADMIN_AND_OFFERS_PLAN.md §3),
// sent by the page with navigator.sendBeacon. The answer never waits for the
// database write.

export const dynamic = "force-dynamic";

const limiter = createRateLimiter(120, 60_000);
const Body = z.object({
  path: z.string().min(1).max(400),
  ad: z.record(z.string(), z.string().max(300)).optional(),
});

export async function POST(request: Request) {
  const userAgent = request.headers.get("user-agent");
  // Bots are dropped before they use up the address's allowance.
  if (isBot(userAgent)) return new NextResponse(null, { status: 204 });
  const ip = clientKey(request);
  if (!limiter.allow(ip)) return new NextResponse(null, { status: 204 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return new NextResponse(null, { status: 204 });
  const ad = body.data.ad ? adParams(body.data.ad) : null;
  after(async () => {
    await recordVisit(db, { path: body.data.path, ip, userAgent }).catch((err) =>
      console.error("visit: not recorded", err),
    );
    // A landing from an ad (docs/GROWTH_PLAN.md, Phase 0).
    if (ad)
      await recordAdLanding(db, { ip, userAgent, path: body.data.path, params: ad }).catch((err) =>
        console.error("ad landing: not recorded", err),
      );
  });
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
