import { and, desc, eq, gte } from "drizzle-orm";
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
  AD_LOOK,
  carouselCreative,
  imageCreative,
  placementCreative,
  videoCreative,
  factsChanged,
  MAX_NEW_ADS_PER_DAY,
  type AdFacts,
} from "@/domain/marketing/meta-creative";
import {
  AD_FORMATS,
  type AdFormat,
  cardText,
  collageBPage,
  collagePage,
  productPage,
  reelCard,
} from "@/domain/marketing/ad-pages";
import { lintContext, type PostCard, type PostFacts } from "@/domain/social/captions";
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
  /** Draws the ads' pictures and the Reel (adRenderer; tests pass their own). */
  render: AdRenderer;
  /** What each category's visitors did and what it can show today; read from the site when absent. */
  load?: {
    funnel: () => Promise<CategoryFunnel[]>;
    picks: (subcategoryId: string) => Promise<PostFacts | null>;
  };
  /** How long to wait for Meta to process a Reel: tries × ms (default 24 × 5 s). */
  videoWait?: { tries: number; ms: number };
  now?: Date;
};

type Picks = Extract<PostFacts, { kind: "picks" }>;
type Page = Omit<PostCard, "slides">;
export type PictureShape = "square" | "portrait" | "story";

export type AdRenderer = {
  /** The first product whose photo cannot be had, or null when all three load. */
  missingPhoto(facts: Picks): Promise<string | null>;
  /** One page as JPEG: square 1:1, portrait 4:5 (feeds) or story 9:16. */
  picture(page: Page, shape: PictureShape): Promise<Buffer>;
  /** The Reel as MP4, 9:16; null when the server cannot make videos (no ffmpeg). */
  reel(card: PostCard): Promise<Buffer | null>;
};

/**
 * The real renderer: the site's post designs (services/social/render.tsx) and its Reel maker
 * (services/social/video.ts, ffmpeg). Every ad leads with the products' photos (owner, 24 Nov
 * 2026: product pictures and Trilio's branding), so an ad is not made unless all three load.
 */
export function adRenderer(): AdRenderer {
  return {
    async missingPhoto(facts) {
      const { loadPhoto } = await import("@/services/social/render");
      for (const p of facts.picks.slice(0, 3)) if (!(await loadPhoto(p.imageUrl ?? undefined))) return p.name;
      return null;
    },
    async picture(page, shape) {
      const { renderPostJpeg } = await import("@/services/social/render");
      return renderPostJpeg(page, 0, 1, shape);
    },
    async reel(card) {
      const { renderReel } = await import("@/services/social/video");
      return renderReel(card);
    },
  };
}

const adFacts = (f: Picks): AdFacts => ({
  look: AD_LOOK,
  category: f.category,
  picks: f.picks.map((p) => ({ name: p.name, priceCents: p.priceCents, shop: p.shop })),
});

/** What each format is called on the admin page and in the log. */
export const FORMAT_LABEL: Record<AdFormat, string> = {
  collage: "attēls A",
  collage_b: "attēls B",
  carousel: "karusele",
  reel: "Reel video",
};

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
  const key = (sub: string, format: string) => `${sub}:${format}`;
  for (const ad of running) {
    const facts = current.get(ad.subcategoryId);
    if (!wanted.includes(ad.subcategoryId))
      await retire(ad, "room", "kategorijai šodien nav vietas budžetā.");
    else if (facts && (ad.facts.look ?? 1) !== AD_LOOK)
      await retire(ad, "facts", "attēls tiek nomainīts uz jauno noformējumu ar preču fotogrāfijām.");
    else if (!facts || factsChanged(ad.facts, adFacts(facts)))
      await retire(ad, "facts", "cenas vai preces vairs nav tās, ko rāda vietne.");
    else keep.add(key(ad.subcategoryId, ad.format));
  }
  const missing = wanted.flatMap((sub) =>
    AD_FORMATS.filter((f) => !keep.has(key(sub, f))).map((format) => ({ sub, format })),
  );
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

  const speaker = { pageId: deps.config.pageId, instagramUserId: deps.config.instagramUserId };
  const failed = async (name: string, why: string) => {
    out.failed++;
    await note("meta_create", null, `Reklāma “${name}” netika izveidota.`, why.slice(0, 400));
  };
  const upload = async (jpeg: Buffer) => {
    const r = await deps.meta.uploadImage(jpeg);
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  const checked = new Map<string, string | null>();

  for (const { sub, format } of missing) {
    if (room <= 0) break;
    const facts = current.get(sub)!;
    const shown = adFacts(facts);
    const text = adText(shown);
    const name = adName(sub, day, format);
    // The same honesty rules as every post: no price or number that is not in the data.
    const ctx = lintContext(facts);
    const issues = [...lintPost(text.message, ctx), ...lintPost(text.headline, ctx)];
    if (issues.length) {
      await failed(name, `teksts: ${issues.join("; ")}`);
      continue;
    }
    if (!checked.has(sub)) checked.set(sub, await deps.render.missingPhoto(facts).catch(() => "?"));
    const noPhoto = checked.get(sub);
    if (noPhoto) {
      await failed(name, `attēls: nav fotogrāfijas precei ${noPhoto}`);
      continue;
    }
    const link = adLink(deps.config.baseUrl, sub, name);
    const words = { link, ...text };
    let creative: Record<string, unknown>;
    let imageHash: string;
    let fellBack: string | null = null;
    try {
      if (format === "collage" || format === "collage_b") {
        const page =
          format === "collage"
            ? collagePage(facts, deps.config.baseUrl)
            : collageBPage(facts, deps.config.baseUrl);
        const hashes = {
          square: await upload(await deps.render.picture(page, "square")),
          portrait: await upload(await deps.render.picture(page, "portrait")),
          story: await upload(await deps.render.picture(page, "story")),
        };
        imageHash = hashes.square;
        // Pictures shaped per placement are a creative of their own; Meta may refuse them for
        // this kind of campaign, and then the square picture goes everywhere.
        const made = await deps.meta.createCreative(placementCreative(speaker, words, hashes, name));
        if (made.ok) creative = { creative_id: made.id };
        else {
          fellBack = made.error;
          creative = imageCreative(speaker, words, hashes.square, name);
        }
      } else if (format === "carousel") {
        const cards = [];
        for (let i = 0; i < 3; i++)
          cards.push({
            imageHash: await upload(await deps.render.picture(productPage(facts, i), "square")),
            ...cardText(facts, i),
          });
        imageHash = cards[0]!.imageHash;
        creative = carouselCreative(speaker, words, cards, name);
      } else {
        const mp4 = await deps.render.reel(reelCard(facts, deps.config.baseUrl));
        if (!mp4) {
          await noVideoOnce();
          continue;
        }
        const video = await deps.meta.uploadVideo(mp4);
        if (!video.ok) throw new Error(video.error);
        imageHash = await upload(await deps.render.picture(collagePage(facts, deps.config.baseUrl), "story"));
        const ready = await waitForVideo(video.id);
        if (ready !== "ready") throw new Error(ready);
        creative = videoCreative(speaker, words, video.id, imageHash, name);
      }
    } catch (err) {
      await failed(name, (err as Error).message);
      continue;
    }
    room--;
    const ad = await deps.meta.createAd({ adsetId: adset, name, creative, domain: deps.config.domain });
    await note(
      "meta_create",
      ad.ok ? ad.id : null,
      `Jauna reklāma “${name}” (${FORMAT_LABEL[format]}): ${shown.category}, 3 varianti šodienas cenās.${
        fellBack ? " Viens kvadrātveida attēls visur: Meta neļāva attēlus pa izvietojumiem." : ""
      }`,
      ad.ok ? undefined : ad.error,
    );
    if (fellBack && ad.ok)
      await note(
        "meta_create",
        ad.id,
        `Attēli pa izvietojumiem reklāmai “${name}” netika pieņemti.`,
        fellBack,
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
      format,
      facts: shown,
      message: text.message,
      headline: text.headline,
      link,
      imageHash,
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

  /** Meta takes a while to process a video; the ad is made once it is ready. */
  async function waitForVideo(id: string): Promise<string> {
    const wait = deps.videoWait ?? { tries: 24, ms: 5_000 };
    for (let i = 0; i < wait.tries; i++) {
      const st = await deps.meta.videoStatus(id);
      if (st.status === "ready") return "ready";
      if (st.status === "error") return st.error ?? "Meta: video error";
      await new Promise((r) => setTimeout(r, wait.ms));
    }
    return "Meta vēl apstrādā video; mēģinās nākamreiz.";
  }

  /** Without ffmpeg there is no Reel: said once a week, not every morning. */
  async function noVideoOnce() {
    const why =
      "Reel video netiek veidots: serverī nav ffmpeg (Railway: RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg).";
    const [seen] = await db
      .select({ id: marketingActions.id })
      .from(marketingActions)
      .where(
        and(
          eq(marketingActions.reason, why),
          gte(marketingActions.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
        ),
      )
      .limit(1);
    if (!seen) await note("meta_create", null, why, "ffmpeg");
  }
}

/** The agent's ads, newest first, for the admin page. */
export async function agentAds(db: Db, limit = 30) {
  return db.select().from(metaAgentAds).orderBy(desc(metaAgentAds.createdAt)).limit(limit);
}
