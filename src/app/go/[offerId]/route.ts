import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { ASK_COOKIE, askAnswered, ASK_TTL_MS, cookieValue } from "@/domain/analytics/ask-cookie";
import { signalsOf } from "@/domain/analytics/click-quality";
import { appBaseUrl } from "@/services/payments";
import { z } from "zod";
import { db, offers, products, stores } from "@/db";
import { isBot } from "@/domain/analytics/visits";
import { adLandingFor } from "@/services/growth/landings";
import { clientKey } from "@/services/rate-limit";
import { auth } from "@/auth";
import { isAdminEmail } from "@/config/admin";
import { clickSource } from "@/domain/analytics/click-source";
import { recordUiEvent } from "@/services/notify/events";
import { countBot, recordShopClick } from "@/services/visits/visits";

// "Pirkt — {Shop}" affiliate link. The target is built from the database
// only (store template + stored offer URL), never from the request, so this
// cannot be used as an open redirect. A person's click is recorded for
// commission reconciliation, once per product per 30 minutes; a bot is
// redirected the same way but only counted as a filtered bot.
//
// The question before the shop is asked here too (docs/CLICK_QUALITY_PLAN.md §2):
// a card's "Pirkt" link (`from=card`) without an answer from the last 24 hours
// opens the question page instead of the shop, so a click before the page's
// JavaScript ran, or by a client that never runs it, sees the question and is
// not counted as a shop click. "Uz {Shop}" (`from=ask`) remembers the answer.

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
  // Which link it came from; "ask" is "Uz {Shop}" in the question before the shop (docs/PRICE_NOTIFY_PLAN.md §8.4).
  const source = clickSource(params);
  const fromAsk = source === "ask";
  const userAgent = request.headers.get("user-agent");
  const bot = isBot(userAgent);
  if (!bot && source === "card" && !askAnswered(cookieValue(request.headers.get("cookie")))) {
    const sid = z.string().uuid().safeParse(sessionId).success ? sessionId : null;
    let english = false;
    try {
      english = /^\/en(\/|$)/.test(new URL(request.headers.get("referer") ?? "").pathname);
    } catch {
      english = false;
    }
    const path = `${english ? "/en" : ""}/pirms-veikala/${parsed.data.offerId}${sid ? `?s=${sid}` : ""}`;
    return NextResponse.redirect(new URL(path, appBaseUrl()), {
      status: 302,
      headers: { "cache-control": "no-store" },
    });
  }
  // Every requester is sent on to the shop; only people are counted (bots, and a
  // visitor's repeat click on the same product within 30 minutes, are not).
  if (bot) {
    after(() => countBot(db, "click").catch(() => undefined));
  } else {
    const ip = clientKey(request);
    // Credited to today's ad visit of the same visitor, if any (docs/GROWTH_PLAN.md, Phase 0).
    const adLandingId = await adLandingFor(db, { ip, userAgent }).catch(() => null);
    // The owner's own clicks are kept for the record but left out of the statistics.
    const internal = isAdminEmail((await auth().catch(() => null))?.user?.email ?? "");
    await recordShopClick(db, {
      offerId: parsed.data.offerId,
      ip,
      userAgent,
      searchSessionId: z.string().uuid().safeParse(sessionId).success ? sessionId : null,
      adLandingId,
      source,
      internal,
      signals: signalsOf(request.headers),
    }).catch(() => undefined);
    if (fromAsk && !internal)
      after(() => recordUiEvent(db, { ip, userAgent }, "ask_shop", row.subcategoryId).catch(() => undefined));
  }

  const target = buildAffiliateUrl(row.template, row.url, row.ean);
  const response = NextResponse.redirect(target, {
    status: 302,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" },
  });
  // The answer holds for a day, also where the page's own script could not store it.
  if (fromAsk && !bot)
    response.cookies.set(ASK_COOKIE, String(Date.now()), {
      path: "/",
      maxAge: ASK_TTL_MS / 1000,
      sameSite: "lax",
      secure: appBaseUrl().startsWith("https:"),
    });
  return response;
}
