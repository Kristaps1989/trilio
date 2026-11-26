import { desc, eq, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { marketingActions, metaAdEntities, metaAgentAds } from "@/db/schema";
import { companyFromEnv } from "@/config/company";
import { rigaDay } from "@/domain/analytics/visits";
import {
  adLink,
  adName,
  adText,
  AGENT_ADSET,
  AGENT_CAMPAIGN,
  categoriesToAdvertise,
  type CategoryFunnel,
  factsChanged,
  MAX_NEW_ADS_PER_DAY,
  type AdFacts,
} from "@/domain/marketing/meta-creative";
import { composePost, lintContext, type PostFacts } from "@/domain/social/captions";
import { lintPost } from "@/domain/social/lint";
import { dayOffset, siteUrl } from "@/services/ads/account";
import { notifyFunnel } from "@/services/notify/events";
import { picksFacts } from "@/services/social/facts";
import type { DsaNames, MetaAdsProvider } from "./meta-ads";

// The agent's own Meta ads (docs/GROWTH_PLAN.md, "One agent for every channel"; owner,
// 24 Nov 2026: the agent creates and publishes ads on its own, after the honesty checks).
// One campaign, optimised for e-mails left on the site, one ad set for Latvia, and one ad per
// category worth advertising: its three picks at today's prices, drawn like the page's posts.
// Each morning an ad whose products or prices are no longer what the site shows is paused
// and a fresh one takes its place, so a running ad never quotes yesterday's price.

export type CreatorConfig = {
  pageId: string;
  instagramUserId: string | null;
  pixelId: string;
  advertiser: string;
  /** The ad set's advertiser and payer as set by hand; else read from the ad account. */
  dsa: DsaNames | null;
  baseUrl: string;
  domain: string;
};

/** What creating an ad needs: the page it speaks as and the pixel that counts its e-mails. */
export function creatorConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): CreatorConfig | null {
  const pageId = env.META_PAGE_ID?.trim();
  const pixelId = env.META_PIXEL_ID?.trim();
  if (!pageId || !/^\d{5,20}$/.test(pageId) || !pixelId || !/^\d{10,20}$/.test(pixelId)) return null;
  const baseUrl = siteUrl();
  return {
    pageId,
    pixelId,
    instagramUserId: env.META_IG_USER_ID?.trim() || null,
    advertiser: companyFromEnv(env).name || "Trilio",
    dsa: dsaFromEnv(env),
    baseUrl,
    domain: new URL(baseUrl).hostname.replace(/^www\./, ""),
  };
}

/** META_DSA_BENEFICIARY and META_DSA_PAYOR (the payer defaults to the advertiser). */
export function dsaFromEnv(env: Record<string, string | undefined>): DsaNames | null {
  const beneficiary = env.META_DSA_BENEFICIARY?.trim();
  if (!beneficiary) return null;
  return { beneficiary, payor: env.META_DSA_PAYOR?.trim() || beneficiary };
}

export type CreatorDeps = {
  meta: MetaAdsProvider;
  config: CreatorConfig;
  /** The ad's square picture as JPEG, from the category's facts. */
  render: (facts: PostFacts) => Promise<Buffer>;
  /** What each category's visitors did and what it can show today; read from the site when absent. */
  load?: {
    funnel: () => Promise<CategoryFunnel[]>;
    picks: (subcategoryId: string) => Promise<PostFacts | null>;
  };
  now?: Date;
};

/**
 * The ad's picture, square: the page's own "collage" design, which leads with the three
 * products' photos under Trilio's logo and names them with today's prices (owner, 24 Nov 2026:
 * product pictures and Trilio's branding; a product, not an explanation, stops a thumb in the
 * feed). An ad without its products' photos is not made: every photo must load, or this throws.
 * The picture quotes prices, which is why an ad is replaced the day a price changes.
 */
export async function renderAdPicture(facts: PostFacts, baseUrl: string): Promise<Buffer> {
  const { loadPhoto, renderPostJpeg } = await import("@/services/social/render");
  if (facts.kind !== "picks") throw new Error("not a picks ad");
  for (const p of facts.picks)
    if (!(await loadPhoto(p.imageUrl ?? undefined))) throw new Error(`no photo of ${p.name}`);
  const { card } = composePost(facts, { postId: "ad", baseUrl, design: "collage" });
  // One picture: the design's own first page, without the carousel's further slides.
  const { slides: _slides, ...single } = card;
  void _slides;
  return renderPostJpeg(single, 0, 1, "square");
}

const adFacts = (f: Extract<PostFacts, { kind: "picks" }>): AdFacts => ({
  category: f.category,
  picks: f.picks.map((p) => ({ name: p.name, priceCents: p.priceCents, shop: p.shop })),
});

export type CreatorRun = { created: number; retired: number; failed: number };

/** Meta's statuses of an ad that does not run and will not by itself. */
const STOPPED = new Set(["PAUSED", "DISAPPROVED", "DELETED", "ARCHIVED"]);
/** How long a category rests after its ad was stopped for bringing nothing, or by hand. */
export const REST_DAYS = 14;

/**
 * Keeps the agent's ads in step with Meta's share of the day: the campaign and the ad set
 * exist, the categories worth an ad each have one that tells today's truth, and the rest
 * are paused. At most three new ads a day. Every step is written to `marketing_actions`.
 */
export async function ensureAgentAds(db: Db, deps: CreatorDeps, shareCents: number): Promise<CreatorRun> {
  const now = deps.now ?? new Date();
  const day = rigaDay(now);
  const out: CreatorRun = { created: 0, retired: 0, failed: 0 };
  const note = (kind: string, entityId: string | null, reason: string, error?: string) =>
    db.insert(marketingActions).values({
      day,
      kind,
      entityId,
      detail: {},
      reason,
      applied: !error,
      error: error ?? null,
    });

  // Which categories, from what their visitors did in 28 days and what can show picks now.
  const funnel = deps.load
    ? await deps.load.funnel()
    : await notifyFunnel(db, dayOffset(now, 28), dayOffset(now, 0));
  const picks = deps.load?.picks ?? ((sub: string) => picksFacts(db, sub, now));
  const current = new Map<string, Extract<PostFacts, { kind: "picks" }>>();
  for (const f of funnel) {
    const facts = await picks(f.subcategoryId).catch(() => null);
    // Three picks, each with its photo: the ad is its products' pictures.
    if (facts?.kind === "picks" && facts.picks.length >= 3 && facts.picks.every((p) => p.imageUrl))
      current.set(f.subcategoryId, facts);
  }
  // An ad that was stopped in Meta (by the owner, by Meta's review, or by the rule for ads that
  // bring nothing) is no longer the agent's running ad.
  const entities0 = new Map((await db.select().from(metaAdEntities)).map((e) => [e.id, e]));
  for (const ad of await db.select().from(metaAgentAds).where(eq(metaAgentAds.status, "active"))) {
    const e = entities0.get(ad.adId);
    if (e && !STOPPED.has(e.effectiveStatus) && !STOPPED.has(e.status)) continue;
    await db
      .update(metaAgentAds)
      .set({ status: "paused", retiredAt: now, retiredWhy: "stopped" })
      .where(eq(metaAgentAds.id, ad.id));
  }
  // Its category rests for two weeks: the same picture and words would do no better tomorrow.
  const rested = new Set(
    (
      await db
        .select({ sub: metaAgentAds.subcategoryId, why: metaAgentAds.retiredWhy })
        .from(metaAgentAds)
        .where(gte(metaAgentAds.retiredAt, new Date(now.getTime() - REST_DAYS * 86_400_000)))
    )
      .filter((r) => r.why === "stopped" || r.why === "no_leads")
      .map((r) => r.sub),
  );
  const wanted = categoriesToAdvertise(
    funnel,
    new Set([...current.keys()].filter((sub) => !rested.has(sub))),
    shareCents,
  );
  const running = await db.select().from(metaAgentAds).where(eq(metaAgentAds.status, "active"));

  const retire = async (ad: (typeof running)[number], code: "room" | "facts", why: string) => {
    const r = await deps.meta.setStatus(ad.adId, "PAUSED");
    await note("meta_pause", ad.adId, `Reklāma “${ad.name}”: ${why}`, r.ok ? undefined : r.error);
    if (!r.ok) {
      out.failed++;
      return false;
    }
    out.retired++;
    await db
      .update(metaAgentAds)
      .set({ status: "paused", retiredAt: now, retiredWhy: code })
      .where(eq(metaAgentAds.id, ad.id));
    await db
      .update(metaAdEntities)
      .set({ status: "PAUSED", effectiveStatus: "PAUSED" })
      .where(eq(metaAdEntities.id, ad.adId));
    return true;
  };

  // An ad that no longer tells the truth, or whose category lost its place, stops first.
  const keep = new Set<string>();
  for (const ad of running) {
    const facts = current.get(ad.subcategoryId);
    if (!wanted.includes(ad.subcategoryId))
      await retire(ad, "room", "kategorijai šodien nav vietas budžetā.");
    else if (!facts || factsChanged(ad.facts, adFacts(facts)))
      await retire(ad, "facts", "cenas vai preces vairs nav tās, ko rāda vietne.");
    else keep.add(ad.subcategoryId);
  }
  const missing = wanted.filter((sub) => !keep.has(sub));
  if (missing.length === 0) return out;

  const madeToday = await db
    .select({ id: metaAgentAds.id })
    .from(metaAgentAds)
    .where(gte(metaAgentAds.createdAt, new Date(`${day}T00:00:00Z`)))
    .limit(MAX_NEW_ADS_PER_DAY + 1);
  let room = MAX_NEW_ADS_PER_DAY - madeToday.length;
  if (room <= 0) return out;

  // The campaign and its ad set, made once.
  const entities = await db.select().from(metaAdEntities);
  let campaign = entities.find((e) => e.level === "campaign" && e.name === AGENT_CAMPAIGN)?.id ?? null;
  if (!campaign) {
    const r = await deps.meta.createCampaign({ name: AGENT_CAMPAIGN, dailyBudgetCents: shareCents });
    await note(
      "meta_create",
      r.ok ? r.id : null,
      `Jauna Meta kampaņa “${AGENT_CAMPAIGN}”: mērķis ir vietnē atstāts e-pasts.`,
      r.ok ? undefined : r.error,
    );
    if (!r.ok) return { ...out, failed: out.failed + 1 };
    campaign = r.id;
    await db.insert(metaAdEntities).values({
      id: campaign,
      level: "campaign",
      name: AGENT_CAMPAIGN,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      dailyBudgetCents: shareCents,
    });
  }
  let adset = entities.find((e) => e.level === "adset" && e.campaignId === campaign)?.id ?? null;
  if (!adset) {
    const r = await deps.meta.createAdSet({
      campaignId: campaign,
      name: AGENT_ADSET,
      pixelId: deps.config.pixelId,
      advertiser: deps.config.advertiser,
      dsa: deps.config.dsa,
    });
    await note(
      "meta_create",
      r.ok ? r.id : null,
      "Jauna reklāmu kopa: Latvija, Meta pati izvēlas auditoriju un izvietojumus.",
      r.ok ? undefined : r.error,
    );
    if (!r.ok) return { ...out, failed: out.failed + 1 };
    adset = r.id;
    await db.insert(metaAdEntities).values({
      id: adset,
      level: "adset",
      name: AGENT_ADSET,
      campaignId: campaign,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
    });
  }

  for (const sub of missing) {
    if (room-- <= 0) break;
    const facts = current.get(sub)!;
    const shown = adFacts(facts);
    const text = adText(shown);
    const name = adName(sub, day);
    // The same honesty rules as every post: no price or number that is not in the data.
    const ctx = lintContext(facts);
    const issues = [...lintPost(text.message, ctx), ...lintPost(text.headline, ctx)];
    if (issues.length) {
      out.failed++;
      await note(
        "meta_create",
        null,
        `Reklāma “${name}” netika izveidota.`,
        `teksts: ${issues.join("; ")}`.slice(0, 400),
      );
      continue;
    }
    const picture = await deps.render(facts).catch((err: Error) => err);
    if (picture instanceof Error) {
      out.failed++;
      await note(
        "meta_create",
        null,
        `Reklāma “${name}” netika izveidota.`,
        `attēls: ${picture.message}`.slice(0, 400),
      );
      continue;
    }
    const image = await deps.meta.uploadImage(picture);
    if (!image.ok) {
      out.failed++;
      await note("meta_create", null, `Reklāma “${name}” netika izveidota.`, image.error);
      continue;
    }
    const link = adLink(deps.config.baseUrl, sub, name);
    const ad = await deps.meta.createAd({
      adsetId: adset,
      name,
      pageId: deps.config.pageId,
      instagramUserId: deps.config.instagramUserId,
      link,
      message: text.message,
      headline: text.headline,
      description: text.description,
      imageHash: image.id,
      domain: deps.config.domain,
    });
    await note(
      "meta_create",
      ad.ok ? ad.id : null,
      `Jauna reklāma “${name}”: ${shown.category}, 3 varianti šodienas cenās.`,
      ad.ok ? undefined : ad.error,
    );
    if (!ad.ok) {
      out.failed++;
      continue;
    }
    out.created++;
    await db.insert(metaAgentAds).values({
      adId: ad.id,
      subcategoryId: sub,
      name,
      facts: shown,
      message: text.message,
      headline: text.headline,
      link,
      imageHash: image.id,
    });
    await db
      .insert(metaAdEntities)
      .values({
        id: ad.id,
        level: "ad",
        name,
        campaignId: campaign,
        adsetId: adset,
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
      })
      .onConflictDoNothing();
  }
  return out;
}

/** The agent's ads, newest first, for the admin page. */
export async function agentAds(db: Db, limit = 30) {
  return db.select().from(metaAgentAds).orderBy(desc(metaAgentAds.createdAt)).limit(limit);
}
