import { after, NextResponse } from "next/server";
import { db } from "@/db";
import { isBot } from "@/domain/analytics/visits";
import { landingWithTags } from "@/domain/growth/tv";
import { getTvCampaign, recordTvLinkOpen } from "@/services/growth/tv";
import { appBaseUrl } from "@/services/payments";

// The short address shown on TV or in a QR code: trilio.lv/tv/<campaign>. It
// leads to the campaign's page with utm tags, so the visit, and the shop
// clicks and saves after it, are credited to the TV campaign like an ad click.

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const campaign = await getTvCampaign(db, slug.toLowerCase()).catch(() => null);
  if (!campaign) return NextResponse.redirect(`${appBaseUrl()}/`, 302);
  if (!isBot(request.headers.get("user-agent")))
    after(() => recordTvLinkOpen(db, campaign.slug).catch(() => undefined));
  return NextResponse.redirect(`${appBaseUrl()}${landingWithTags(campaign.landingPath, campaign.slug)}`, {
    status: 302,
    headers: { "cache-control": "no-store" },
  });
}
