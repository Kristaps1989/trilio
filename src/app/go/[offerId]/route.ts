import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db, offers, products, stores } from "@/db";
import { isBot } from "@/domain/analytics/visits";
import { adLandingFor } from "@/services/growth/landings";
import { clientKey } from "@/services/rate-limit";
import { recordUiEvent } from "@/services/notify/events";
import { countBot, recordShopClick } from "@/services/visits/visits";

// "Pirkt — {Shop}" affiliate link. The target is built from the database
// only (store template + stored offer URL), never from the request, so this
// cannot be used as an open redirect. A person's click is recorded for
// commission reconciliation, once per product per 30 minutes; a bot is
// redirected the same way but only counted as a filtered bot.

export const dynamic = "force-dynamic";

const Params = z.object({ offerId: z.string().uuid() });

export function buildAffiliateUrl(template: string | null, offerUrl: string, ean: string | null): string {
  if (!template) return offerUrl;
  return template
    .replace("{url}", encodeURIComponent(offerUrl))
    .replace("{url_raw}", offerUrl)
    .replace("{ean}", ean ?? "");
}

export async function GET(request: Request, ctx: { params: Promise<{ offerId: string }> }) {
  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return new NextResponse(null, { status: 404 });
  const [row] = await db
    .select({
      url: offers.url,
      template: stores.affiliateTemplateUrl,
      active: stores.active,
      ean: products.ean,
      subcategoryId: products.subcategoryId,
    })
    .from(offers)
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .innerJoin(products, eq(products.id, offers.productId))
    .where(eq(offers.id, parsed.data.offerId));
  if (!row || !row.active) return new NextResponse(null, { status: 404 });

  const params = new URL(request.url).searchParams;
  const sessionId = params.get("s");
  // "Uz {Shop}" chosen in the question before the shop (docs/PRICE_NOTIFY_PLAN.md §8.4).
  const fromAsk = params.get("ask") === "1";
  const userAgent = request.headers.get("user-agent");
  // Every requester is sent on to the shop; only people are counted (bots, and a
  // visitor's repeat click on the same product within 30 minutes, are not).
  if (isBot(userAgent)) {
    after(() => countBot(db, "click").catch(() => undefined));
  } else {
    const ip = clientKey(request);
    // Credited to today's ad visit of the same visitor, if any (docs/GROWTH_PLAN.md, Phase 0).
    const adLandingId = await adLandingFor(db, { ip, userAgent }).catch(() => null);
    await recordShopClick(db, {
      offerId: parsed.data.offerId,
      ip,
      userAgent,
      searchSessionId: z.string().uuid().safeParse(sessionId).success ? sessionId : null,
      adLandingId,
    }).catch(() => undefined);
    if (fromAsk)
      after(() => recordUiEvent(db, { ip, userAgent }, "ask_shop", row.subcategoryId).catch(() => undefined));
  }

  const target = buildAffiliateUrl(row.template, row.url, row.ean);
  return NextResponse.redirect(target, {
    status: 302,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" },
  });
}
