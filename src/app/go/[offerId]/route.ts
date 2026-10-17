import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { affiliateClicks, db, offers, products, stores } from "@/db";

// "Pirkt — {Shop}" affiliate link. The target is built from the database
// only (store template + stored offer URL), never from the request, so this
// cannot be used as an open redirect. Every click is recorded for
// commission reconciliation.

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
    })
    .from(offers)
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .innerJoin(products, eq(products.id, offers.productId))
    .where(eq(offers.id, parsed.data.offerId));
  if (!row || !row.active) return new NextResponse(null, { status: 404 });

  const sessionId = new URL(request.url).searchParams.get("s");
  await db
    .insert(affiliateClicks)
    .values({
      offerId: parsed.data.offerId,
      searchSessionId: z.string().uuid().safeParse(sessionId).success ? sessionId : null,
    })
    .catch(() => undefined);

  const target = buildAffiliateUrl(row.template, row.url, row.ean);
  return NextResponse.redirect(target, {
    status: 302,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" },
  });
}
