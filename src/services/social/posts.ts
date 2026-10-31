import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { appFlags, socialInsights, socialPosts, type SocialKind, type SocialPost } from "@/db/schema";
import { leaks } from "@/domain/social/anonymise";
import {
  composePost,
  lintContext,
  slideAlt,
  utmLink,
  type PostCard,
  type PostFacts,
} from "@/domain/social/captions";
import { lintPost } from "@/domain/social/lint";
import {
  DRAFT_AHEAD_MS,
  LATE_LIMIT_MS,
  nextCategory,
  nextFreeEvening,
  pickKind,
  rigaDayOf,
  slotsBetween,
  type Availability,
} from "@/domain/social/schedule";
import { wrapUntrusted, type StructuredCaller } from "@/services/llm/client";
import {
  adviceFacts,
  categoriesByTraffic,
  knownCategories,
  paidOfferFacts,
  picksFacts,
  priceDropFacts,
  topCategoriesFacts,
  topProductsFacts,
} from "./facts";
import type { Network, PublishResult, SocialProvider } from "./provider";

// Drafting, approving and publishing posts (docs/SOCIAL_PLAN.md §7). A post
// is drafted from live data a day ahead; right before it goes out its prices
// are read again, and a post whose numbers no longer hold is not sent.

export type SocialDeps = {
  provider: SocialProvider | null;
  baseUrl: string;
  caller?: StructuredCaller | null;
};

export type SocialMode = "approve" | "auto";
export type SocialSettings = { enabled: boolean; mode: SocialMode };

const SYSTEM = "sistēma";
const KEYS = { enabled: "social_enabled", mode: "social_mode", insightsDay: "social_insights_day" } as const;

async function flag(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(appFlags).where(eq(appFlags.key, key));
  return row?.value ?? null;
}
async function setFlag(db: Db, key: string, value: string) {
  await db
    .insert(appFlags)
    .values({ key, value })
    .onConflictDoUpdate({ target: appFlags.key, set: { value, updatedAt: new Date() } });
}

/** On by default (nothing is sent without a provider); approve mode until the owner switches (D3). */
export async function socialSettings(db: Db): Promise<SocialSettings> {
  return {
    enabled: (await flag(db, KEYS.enabled)) !== "0",
    mode: (await flag(db, KEYS.mode)) === "auto" ? "auto" : "approve",
  };
}

export async function updateSocialSettings(db: Db, s: Partial<SocialSettings>) {
  if (s.enabled !== undefined) await setFlag(db, KEYS.enabled, s.enabled ? "1" : "0");
  if (s.mode) await setFlag(db, KEYS.mode, s.mode);
}

const recent = async (db: Db, kind: SocialKind, n: number) =>
  db
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.kind, kind), sql`${socialPosts.status} <> 'skipped'`))
    .orderBy(desc(socialPosts.slotAt))
    .limit(n);

type Found = { facts: PostFacts; personal?: (string | null)[] } | null;

/** Facts for one kind now, honouring rotation and "never the same thing twice" (§3). */
export async function factsFor(db: Db, kind: SocialKind, now: Date): Promise<Found> {
  switch (kind) {
    case "picks":
    case "advice": {
      const traffic = (await categoriesByTraffic(db, now)).map((c) => c.id);
      const done = (await recent(db, kind, 6)).map((p) => p.subcategoryId ?? "");
      const known = knownCategories();
      const tried = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const id = nextCategory(traffic, [...done, ...tried], known);
        if (!id || tried.has(id)) break;
        tried.add(id);
        if (kind === "advice") {
          const turn = (await recent(db, "advice", 200)).filter((p) => p.subcategoryId === id).length;
          const f = adviceFacts(id, turn);
          if (f) return { facts: f };
        } else {
          const f = await picksFacts(db, id, now);
          if (f) return { facts: f };
        }
      }
      return null;
    }
    case "price_drop": {
      const since = new Date(now.getTime() - 30 * 86_400_000);
      const told = await db
        .select({ id: socialPosts.productId })
        .from(socialPosts)
        .where(
          and(
            eq(socialPosts.kind, "price_drop"),
            gte(socialPosts.slotAt, since),
            isNotNull(socialPosts.productId),
          ),
        );
      const f = await priceDropFacts(
        db,
        now,
        told.map((t) => t.id!),
      );
      return f ? { facts: f } : null;
    }
    case "offer": {
      const used = await db
        .select({ id: socialPosts.specialOfferId })
        .from(socialPosts)
        .where(isNotNull(socialPosts.specialOfferId));
      return paidOfferFacts(
        db,
        used.map((u) => u.id!),
      );
    }
    case "top_categories": {
      const f = await topCategoriesFacts(db, now);
      return f ? { facts: f } : null;
    }
    case "top_products": {
      const f = await topProductsFacts(db, now);
      return f ? { facts: f } : null;
    }
    case "reel":
      return null;
  }
}

const LeadSchema = z.object({ lead: z.string().min(5).max(120) });

/** Claude's opening line for picks and advice posts; the template's when it fails the lint (§2). */
async function claudeLead(caller: StructuredCaller | null | undefined, f: PostFacts): Promise<string | null> {
  if (!caller || (f.kind !== "picks" && f.kind !== "advice")) return null;
  const res = await caller({
    purpose: "social_copy",
    system: [
      "You write the first line of a Latvian Facebook and Instagram post for Trilio (trilio.lv), which helps people choose household appliances: a few questions, then three suitable options from partner shops, and a button to ask Trilio for a better price.",
      "One sentence, at most 90 characters, written only in Latvian (never English, not even a part of it). A concrete worry or wish of someone buying this category, in everyday words. No pronoun of address at all: no 'tu', 'tev', 'jūs', 'jums'. Statements or questions without them.",
      "Honest only: no 'labākais', 'lētākais', 'garantēti', no discounts, percentages, urgency, prices or numbers, no shop or competitor names, no exclamation marks.",
    ].join("\n\n"),
    user: wrapUntrusted(
      "post",
      JSON.stringify({
        kind: f.kind,
        category: "category" in f ? f.category : null,
        factor: f.kind === "advice" ? f.factor : null,
      }),
    ),
    schema: LeadSchema,
    maxTokens: 400,
    cache: false,
    timeoutMs: 60_000,
  });
  return res.ok ? res.value.lead.trim() : null;
}

export type CreateResult = { ok: true; post: SocialPost } | { ok: false; reason: string };

/** Composes, checks (lint and personal data) and stores one post. Never stores a post that fails. */
export async function createPost(
  db: Db,
  deps: SocialDeps,
  input: {
    facts: PostFacts;
    slotAt: Date;
    createdBy: string;
    personal?: (string | null)[];
    mode: SocialMode;
    videoUrl?: string;
  },
): Promise<CreateResult> {
  const id = randomUUID();
  const lead = await claudeLead(deps.caller, input.facts).catch(() => null);
  let post = composePost(input.facts, { postId: id, baseUrl: deps.baseUrl, lead: lead ?? undefined });
  let source = lead ? "claude" : "template";
  if (post.issues.length && lead) {
    post = composePost(input.facts, { postId: id, baseUrl: deps.baseUrl });
    source = "template";
  }
  if (post.issues.length) return { ok: false, reason: post.issues.join("; ") };
  const all = [post.captionFb, post.captionIg, post.alt, JSON.stringify(post.card)].join("\n");
  if (leaks(all, input.personal ?? []).length) return { ok: false, reason: "personal data in the post" };
  const f = input.facts;
  const auto = input.mode === "auto";
  const [row] = await db
    .insert(socialPosts)
    .values({
      id,
      kind: f.kind,
      slotAt: input.slotAt,
      status: auto ? "approved" : "draft",
      subcategoryId: "subcategoryId" in f ? f.subcategoryId : null,
      productId: f.kind === "price_drop" ? f.productId : null,
      specialOfferId: f.kind === "offer" ? f.specialOfferId : null,
      card: { ...post.card, facts: f } as unknown as Record<string, unknown>,
      captionFb: post.captionFb,
      captionIg: post.captionIg,
      alt: post.alt,
      link: post.link,
      videoUrl: input.videoUrl ?? null,
      source,
      createdBy: input.createdBy,
      approvedBy: auto ? SYSTEM : null,
    })
    .returning();
  return { ok: true, post: row! };
}

/** What the coming slots can be filled with (§4). */
async function availability(
  db: Db,
  now: Date,
): Promise<{ has: Availability; found: Map<SocialKind, Found> }> {
  const found = new Map<SocialKind, Found>();
  for (const k of ["price_drop", "offer", "top_categories", "top_products"] as const)
    found.set(k, await factsFor(db, k, now));
  return {
    has: {
      priceDrop: !!found.get("price_drop"),
      paidOffer: !!found.get("offer"),
      topCategories: !!found.get("top_categories"),
      topProducts: !!found.get("top_products"),
    },
    found,
  };
}

/** Drafts every slot of the next ~day that has no post yet. */
export async function draftUpcoming(db: Db, deps: SocialDeps, now = new Date()): Promise<number> {
  const settings = await socialSettings(db);
  if (!settings.enabled) return 0;
  const slots = slotsBetween(now, new Date(now.getTime() + DRAFT_AHEAD_MS));
  if (!slots.length) return 0;
  const taken = await db
    .select({ at: socialPosts.slotAt })
    .from(socialPosts)
    .where(
      inArray(
        socialPosts.slotAt,
        slots.map((s) => s.at),
      ),
    );
  const open = slots.filter((s) => !taken.some((t) => t.at.getTime() === s.at.getTime()));
  if (!open.length) return 0;
  const { has, found } = await availability(db, now);
  let made = 0;
  for (const slot of open) {
    const kind = pickKind(slot, has);
    if (!kind) continue;
    const f = found.get(kind) ?? (await factsFor(db, kind, now));
    if (!f) continue;
    const r = await createPost(db, deps, { ...f, slotAt: slot.at, createdBy: SYSTEM, mode: settings.mode });
    if (r.ok) made++;
  }
  return made;
}

/** A post by hand ("Ģenerēt tagad"): the next free evening, as a draft. */
export async function generateNow(
  db: Db,
  deps: SocialDeps,
  kind: SocialKind,
  admin: string,
  now = new Date(),
): Promise<CreateResult> {
  const f = await factsFor(db, kind, now);
  if (!f) return { ok: false, reason: "no_data" };
  const taken = await db
    .select({ at: socialPosts.slotAt })
    .from(socialPosts)
    .where(gte(socialPosts.slotAt, now));
  return createPost(db, deps, {
    ...f,
    slotAt: nextFreeEvening(
      now,
      taken.map((t) => t.at),
    ),
    createdBy: admin,
    mode: "approve",
  });
}

/** A Reel the owner shot: the video's public URL and the caption, on a chosen evening. */
export async function createReel(
  db: Db,
  deps: SocialDeps,
  input: { videoUrl: string; caption: string; slotAt: Date; admin: string; path?: string },
): Promise<CreateResult> {
  return createPost(db, deps, {
    facts: { kind: "reel", caption: input.caption, videoUrl: input.videoUrl, path: input.path ?? "/" },
    slotAt: input.slotAt,
    createdBy: input.admin,
    mode: "approve",
    videoUrl: input.videoUrl,
  });
}

const prices = (card: PostCard) => card.lines.map((l) => l.side ?? "").join("|");

type StoredCard = PostCard & { facts?: PostFacts; edited?: boolean };

/**
 * The prices read again right before sending. Same numbers: send as is.
 * Changed and untouched by the owner: rewrite with today's numbers. Changed
 * after the owner edited the text, or the fact no longer holds: do not send.
 */
export async function refresh(
  db: Db,
  deps: SocialDeps,
  post: SocialPost,
  now: Date,
): Promise<{ ok: true; post: SocialPost } | { ok: false; reason: string }> {
  const card = post.card as unknown as StoredCard;
  const old = card.facts;
  if (!old || !["picks", "price_drop", "top_products"].includes(post.kind)) return { ok: true, post };
  const next =
    old.kind === "picks"
      ? await picksFacts(db, old.subcategoryId, now)
      : old.kind === "price_drop"
        ? await priceDropFacts(db, now, [], old.productId)
        : await topProductsFacts(db, now);
  if (!next) return { ok: false, reason: "Dati vairs neatbilst (cena vai pieejamība mainījās)." };
  const fresh = composePost(next, { postId: post.id, baseUrl: deps.baseUrl });
  if (prices(fresh.card) === prices(card) && JSON.stringify(fresh.card.lines) === JSON.stringify(card.lines))
    return { ok: true, post };
  if (card.edited)
    return { ok: false, reason: "Cenas mainījās pēc teksta labošanas; pārbaudi un apstiprini vēlreiz." };
  if (fresh.issues.length) return { ok: false, reason: fresh.issues.join("; ") };
  const [row] = await db
    .update(socialPosts)
    .set({
      card: { ...fresh.card, facts: next } as unknown as Record<string, unknown>,
      captionFb: fresh.captionFb,
      captionIg: fresh.captionIg,
      alt: fresh.alt,
      source: "template",
    })
    .where(eq(socialPosts.id, post.id))
    .returning();
  return { ok: true, post: row! };
}

export const imageUrl = (baseUrl: string, id: string) => `${baseUrl}/api/social/${id}/image.jpg`;
/** A carousel's slides; the first is the same image as imageUrl. */
export const slideUrls = (baseUrl: string, id: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    i === 0 ? imageUrl(baseUrl, id) : `${baseUrl}/api/social/${id}/${i + 1}/image.jpg`,
  );

/** Meta's token, permission and rate errors: another format would fail the same way. */
const TOKEN_ERROR = /#(190|200|10|4|17|32)\b/;

/** A link post's caption: the link is the preview below it, so the line with the bare URL goes. */
export function withoutLink(caption: string, link: string): string {
  return caption
    .split("\n")
    .filter((l) => !l.includes(link))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The link preview picture of a post (1200 × 630), named in the landing page's Open Graph tags. */
export const linkImageUrl = (baseUrl: string, id: string) => `${baseUrl}/api/social/${id}/link.jpg`;

/** The square picture of a slide, for a Facebook link carousel card (1:1). */
export const squareUrl = (baseUrl: string, id: string, n: number) =>
  `${baseUrl}/api/social/${id}/${n}/square.jpg`;

/** The site page a post links to: its stored link without host and tags. */
function sitePath(post: SocialPost): string {
  try {
    return new URL(post.link).pathname || "/";
  } catch {
    return "/";
  }
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** One card of a Facebook link carousel: the slide's square picture, a short headline, its own link. */
export function carouselCard(
  baseUrl: string,
  post: SocialPost,
  slide: Omit<PostCard, "slides">,
  i: number,
): { link: string; name: string; description?: string; picture: string } {
  const name =
    slide.layout === "cover" || slide.layout === "closing" || slide.layout === "phone"
      ? [slide.headline, slide.headlineAccent].filter(Boolean).join(" ") || slide.title
      : slide.title;
  const description = slide.stat ? `${slide.stat.label}: ${slide.stat.value}` : slide.sub;
  return {
    link: utmLink(baseUrl, slide.link ?? sitePath(post), "facebook", post.kind, `${post.id}-${i + 1}`),
    name: clip(name, 60),
    ...(description ? { description: clip(description, 90) } : {}),
    picture: squareUrl(baseUrl, post.id, i + 1),
  };
}

/** Sends to the networks that do not have the post yet, so a retry never posts twice. */
export async function publishPost(
  db: Db,
  deps: SocialDeps,
  post: SocialPost,
  now = new Date(),
): Promise<SocialPost> {
  const provider = deps.provider;
  if (!provider) return post;
  const card = post.card as unknown as PostCard;
  const slides = card.slides?.length ?? 0;
  const alts = card.slides?.map(slideAlt) ?? [];
  const fbLink = utmLink(deps.baseUrl, sitePath(post), "facebook", post.kind, post.id);
  const send = async (n: Network, caption: string): Promise<PublishResult> => {
    if (n === "facebook" && !post.videoUrl && slides <= 1) {
      // A link post brings people to the site; its preview is this post's own picture (Open Graph).
      const r = await provider.publishLink(fbLink, withoutLink(caption, fbLink));
      if (r.ok || TOKEN_ERROR.test(r.error)) return r;
    }
    if (post.videoUrl) return provider.publishVideo(n, post.videoUrl, caption);
    if (slides > 1)
      return provider.publishCarousel(
        n,
        slideUrls(deps.baseUrl, post.id, slides).map((url, i) => ({
          url,
          alt: alts[i],
          ...(n === "facebook" ? { card: carouselCard(deps.baseUrl, post, card.slides![i]!, i) } : {}),
        })),
        caption,
        n === "facebook" ? fbLink : undefined,
      );
    return provider.publishImage(n, imageUrl(deps.baseUrl, post.id), caption, post.alt);
  };
  const errors: string[] = [];
  let fb = post.fbPostId;
  let ig = post.igMediaId;
  if (!fb) {
    const r = await send("facebook", post.captionFb);
    if (r.ok) fb = r.id;
    else errors.push(`Facebook: ${r.error}`);
  }
  if (!ig) {
    const r = await send("instagram", post.captionIg);
    if (r.ok) ig = r.id;
    else errors.push(`Instagram: ${r.error}`);
  }
  const [row] = await db
    .update(socialPosts)
    .set({
      fbPostId: fb,
      igMediaId: ig,
      status: errors.length ? "failed" : "published",
      error: errors.length ? errors.join(" · ") : null,
      publishedAt: fb || ig ? (post.publishedAt ?? now) : null,
    })
    .where(eq(socialPosts.id, post.id))
    .returning();
  return row!;
}

/** Sends what is due; drafts nobody approved and posts too late for their slot are skipped. */
export async function publishDue(
  db: Db,
  deps: SocialDeps,
  now = new Date(),
): Promise<{ published: number; skipped: number; failed: number }> {
  const out = { published: 0, skipped: 0, failed: 0 };
  if (!deps.provider || !(await socialSettings(db)).enabled) return out;
  const due = await db
    .select()
    .from(socialPosts)
    .where(and(inArray(socialPosts.status, ["draft", "approved"]), lte(socialPosts.slotAt, now)))
    .orderBy(socialPosts.slotAt);
  for (const p of due) {
    const skip = async (error: string) => {
      await db.update(socialPosts).set({ status: "skipped", error }).where(eq(socialPosts.id, p.id));
      out.skipped++;
    };
    if (p.status === "draft") {
      await skip("Netika apstiprināts līdz publicēšanas laikam.");
      continue;
    }
    if (now.getTime() - p.slotAt.getTime() > LATE_LIMIT_MS) {
      await skip("Nokavēts: vairāk nekā 6 stundas pēc laika.");
      continue;
    }
    const r = await refresh(db, deps, p, now);
    if (!r.ok) {
      await skip(r.reason);
      continue;
    }
    const sent = await publishPost(db, deps, r.post, now);
    if (sent.status === "published") out.published++;
    else out.failed++;
  }
  return out;
}

/** Approve now and, when its time has come, send it at once ("Publicēt tūlīt"). */
export async function approvePost(
  db: Db,
  deps: SocialDeps,
  id: string,
  admin: string,
  opts: { now?: boolean } = {},
) {
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id));
  if (!p || p.status === "published" || p.status === "skipped") return null;
  const [row] = await db
    .update(socialPosts)
    .set({ status: "approved", approvedBy: admin, error: null, ...(opts.now ? { slotAt: new Date() } : {}) })
    .where(eq(socialPosts.id, id))
    .returning();
  if (!opts.now) return row!;
  const r = await refresh(db, deps, row!, new Date());
  if (!r.ok) {
    await db.update(socialPosts).set({ status: "failed", error: r.reason }).where(eq(socialPosts.id, id));
    return null;
  }
  return publishPost(db, deps, r.post);
}

/** The owner's text: the image and its numbers stay; refresh will not overwrite it (§10). */
export async function editCaptions(db: Db, id: string, captionFb: string, captionIg: string) {
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id));
  if (!p || p.status === "published") return { ok: false as const, reason: "locked" };
  const facts = (p.card as unknown as StoredCard).facts;
  const ctx = facts ? lintContext(facts) : {};
  const issues = [...new Set([...lintPost(captionFb, ctx), ...lintPost(captionIg, ctx)])];
  if (issues.length) return { ok: false as const, reason: issues.join("; ") };
  await db
    .update(socialPosts)
    .set({
      captionFb,
      captionIg,
      card: { ...(p.card as Record<string, unknown>), edited: true },
      status: p.status === "failed" ? "draft" : p.status,
    })
    .where(eq(socialPosts.id, id));
  return { ok: true as const };
}

export async function skipPost(db: Db, id: string, reason = "Izlaists.") {
  await db
    .update(socialPosts)
    .set({ status: "skipped", error: reason })
    .where(and(eq(socialPosts.id, id), inArray(socialPosts.status, ["draft", "approved", "failed"])));
}

/** Deletes a published post on both networks and marks it skipped. */
export async function removePost(db: Db, deps: SocialDeps, id: string): Promise<boolean> {
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id));
  if (!p || !deps.provider) return false;
  const fb = p.fbPostId ? await deps.provider.remove("facebook", p.fbPostId) : true;
  const ig = p.igMediaId ? await deps.provider.remove("instagram", p.igMediaId) : true;
  await db
    .update(socialPosts)
    .set({
      status: "skipped",
      error: fb && ig ? "Dzēsts abos tīklos." : "Dzēšana neizdevās vienā no tīkliem.",
    })
    .where(eq(socialPosts.id, id));
  return fb && ig;
}

/** Reach and reactions for the last two weeks' posts, once a Riga day after 09:00. */
export async function syncInsights(
  db: Db,
  deps: SocialDeps,
  now = new Date(),
  force = false,
): Promise<number> {
  const provider = deps.provider;
  if (!provider) return 0;
  const day = rigaDayOf(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Riga", hour: "2-digit", hourCycle: "h23" }).format(
      now,
    ),
  );
  if (!force && ((await flag(db, KEYS.insightsDay)) === day || hour < 9)) return 0;
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const posts = await db
    .select()
    .from(socialPosts)
    .where(and(isNotNull(socialPosts.publishedAt), gte(socialPosts.publishedAt, since)));
  let n = 0;
  for (const p of posts) {
    for (const [network, id] of [
      ["facebook", p.fbPostId],
      ["instagram", p.igMediaId],
    ] as const) {
      if (!id) continue;
      const i = await provider.insights(network, id);
      if (!i) continue;
      await db
        .insert(socialInsights)
        .values({ postId: p.id, network, day, ...i })
        .onConflictDoUpdate({
          target: [socialInsights.postId, socialInsights.network, socialInsights.day],
          set: { ...i },
        });
      n++;
    }
  }
  await setFlag(db, KEYS.insightsDay, day);
  return n;
}
