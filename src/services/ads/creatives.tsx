import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { ImageResponse } from "next/og";
import { z } from "zod";
import type { Db } from "@/db/client";
import { adCampaigns, adCreatives, adKeywords, type AdCreative } from "@/db/schema";
import { loadCandidates } from "@/db/queries/catalog";
import { COMPETITOR_GROUP } from "@/domain/ads/plan";
import { lintAdText } from "@/domain/ads/honesty";
import { eligibleOffers } from "@/domain/ranking/filters";
import { getGroupOfSubcategory, getSubcategory } from "@/domain/questions/catalog";
import { knowledgeOf } from "@/domain/knowledge/knowledge";
import { wrapUntrusted, type StructuredCaller } from "@/services/llm/client";
import seed from "../../../data/keywords.lv.json";
import { send, siteUrl } from "./account";
import { OPTIMISER_MODEL } from "./optimiser";
import type { AdsProvider } from "./provider";

// Creatives (docs/GROWTH_PLAN.md, Phase 3): Claude writes the words, Trilio's
// own template draws them in the brand with live numbers from the catalogue,
// and Google's Asset Studio adds lifestyle variants inside the account.
// Every creative waits for the owner's approval; only approved images are
// uploaded. Video scripts are storyboards for Asset Studio or YouTube.

export const IMAGE_SIZES = ["1200x628", "1200x1200", "300x250"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

const Copy = z.object({
  headline: z.string(),
  body: z.string(),
  video: z.array(z.object({ seconds: z.number().int(), onScreen: z.string(), visual: z.string() })),
});
export type CreativeCopy = z.infer<typeof Copy>;

/** Live facts a creative may quote: how many products in stock, in how many shops. */
export async function liveFacts(db: Db, subcategoryId: string): Promise<{ products: number; shops: number }> {
  const products = await loadCandidates(db, subcategoryId);
  const shops = new Set<string>();
  let n = 0;
  for (const p of products) {
    const live = eligibleOffers(p, "new", "two_weeks");
    if (!live.length) continue;
    n++;
    for (const o of live) shops.add(o.storeId);
  }
  return { products: n, shops: shops.size };
}

function short(subcategoryId: string): string {
  const s = (seed.subcategories as Record<string, { short: string }>)[subcategoryId];
  return s?.short ?? getSubcategory(subcategoryId)?.label ?? "Tehnika";
}

/** Copy that needs no model: always available, always passes the lint. */
export function templateCopy(subcategoryId: string): CreativeCopy {
  const name = short(subcategoryId);
  return {
    headline: `${name}: 3 piemērotākie`.length <= 30 ? `${name}: 3 piemērotākie` : name,
    body: "Atbildi uz dažiem jautājumiem un salīdzini cenas partneru veikalos.",
    video: [
      {
        seconds: 3,
        onScreen: `Izvēlies ${name.toLowerCase()} bez minēšanas`,
        visual: "Kategorijas ilustrācija uz tumši zaļa fona",
      },
      {
        seconds: 4,
        onScreen: "Dažas atbildes par tavām vajadzībām",
        visual: "Jautājuma ekrāns ar izvēles kartītēm",
      },
      {
        seconds: 4,
        onScreen: "3 piemērotākie varianti ar cenām",
        visual: "Trīs rezultātu kartītes ar lomām",
      },
      { seconds: 3, onScreen: "trilio.lv", visual: "Logo un laima akcents" },
    ],
  };
}

/** Claude's copy for a category, checked by the honesty lint; the template when it fails. */
export async function writeCopy(
  db: Db,
  caller: StructuredCaller | null,
  subcategoryId: string,
): Promise<CreativeCopy> {
  const facts = await liveFacts(db, subcategoryId);
  const fallback = templateCopy(subcategoryId);
  if (!caller) return fallback;
  const know = knowledgeOf(subcategoryId);
  const res = await caller({
    purpose: "ads_copy",
    model: OPTIMISER_MODEL,
    system:
      "You write Latvian display and video ad copy for Trilio (trilio.lv), which helps shoppers choose a household appliance: a few questions, then the three best options from partner shops, with reasons. Honest only: no 'cheapest', 'guaranteed', discounts, percentages, urgency, superlatives, shop or competitor names, and no numbers except those given. headline at most 30 characters; body at most 90; video: 3–5 scenes of 2–5 seconds, onScreen at most 40 characters each, visual describes the shot in Latvian.",
    user: wrapUntrusted(
      "category",
      JSON.stringify({
        category: getSubcategory(subcategoryId)?.label,
        shortName: short(subcategoryId),
        whatDecides: know.decides.map((d) => d.why.lv),
        numbersYouMayUse: [3, facts.products, facts.shops].filter((n) => n > 0),
      }),
    ),
    schema: Copy,
    maxTokens: 4000,
    effort: "medium",
    cache: false,
    timeoutMs: 120_000,
  });
  if (!res.ok) return fallback;
  const allowed = { allowedNumbers: [facts.products, facts.shops] };
  const c = res.value;
  const clean =
    lintAdText(c.headline, "headline", allowed).length === 0 &&
    lintAdText(c.body, "description", allowed).length === 0 &&
    c.video.length >= 3 &&
    c.video.every(
      (s) => [...s.onScreen].length <= 40 && lintAdText(s.onScreen, "description", allowed).length === 0,
    );
  return clean ? c : fallback;
}

/** Drafts for one category: an image per size and a video script, waiting for approval. */
export async function createCreatives(db: Db, subcategoryId: string, copy: CreativeCopy, source: string) {
  const rows = await db
    .insert(adCreatives)
    .values([
      ...IMAGE_SIZES.map((size) => ({
        kind: "image",
        subcategoryId,
        size,
        headline: copy.headline,
        body: copy.body,
        source,
      })),
      {
        kind: "video_script",
        subcategoryId,
        headline: copy.headline,
        body: copy.body,
        script: copy.video,
        source,
      },
    ])
    .returning();
  return rows;
}

let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700 }[] | null = null;
async function brandFonts() {
  if (fonts) return fonts;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const load = async (file: string) => readFile(path.join(dir, file));
  fonts = [
    { name: "Space Grotesk", data: await load("space-grotesk-latin-700.ttf"), weight: 700 },
    { name: "Space Grotesk", data: await load("space-grotesk-latin-ext-700.ttf"), weight: 700 },
    { name: "Figtree", data: await load("figtree-latin-400.ttf"), weight: 400 },
    { name: "Figtree", data: await load("figtree-latin-ext-400.ttf"), weight: 400 },
    { name: "Figtree", data: await load("figtree-latin-600.ttf"), weight: 600 },
    { name: "Figtree", data: await load("figtree-latin-ext-600.ttf"), weight: 600 },
  ];
  return fonts;
}

const NIGHT = "#0F2A2E";
const LIME = "#D8F45A";
const MIST = "#F2F5F2";
const STONE = "#A9BDB9";

/** The logo mark from docs/BRAND.md (40×40 grid), drawn with boxes for satori. */
function LogoMark({ size }: { size: number }) {
  const k = size / 40;
  const bar = (x: number, y: number, hgt: number) => (
    <div
      style={{
        position: "absolute",
        left: x * k,
        top: y * k,
        width: 6.5 * k,
        height: hgt * k,
        borderRadius: 2 * k,
        background: NIGHT,
      }}
    />
  );
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: size,
        height: size,
        borderRadius: 11 * k,
        background: LIME,
      }}
    >
      {bar(8.5, 19, 13)}
      {bar(16.75, 14, 18)}
      <div
        style={{
          position: "absolute",
          left: 17 * k,
          top: 6 * k,
          width: 6 * k,
          height: 6 * k,
          borderRadius: 3 * k,
          background: NIGHT,
        }}
      />
      {bar(25, 23, 9)}
    </div>
  );
}

/** The brand template (docs/BRAND.md): night green, lime accent, Space Grotesk and Figtree. */
export async function renderCreative(
  c: Pick<AdCreative, "headline" | "body" | "size" | "subcategoryId">,
  facts: { products: number; shops: number },
): Promise<Response> {
  const [w, h] = (c.size ?? "1200x628").split("x").map(Number) as [number, number];
  const unit = Math.min(w, h) / 600;
  const coverage =
    facts.products > 0
      ? `Izskatām ${facts.products} preces ${facts.shops} ${facts.shops === 1 ? "veikalā" : "veikalos"}`
      : "";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: NIGHT,
        color: MIST,
        padding: 40 * unit,
        fontFamily: "Figtree",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 * unit }}>
        <div style={{ width: 36 * unit, height: 36 * unit, borderRadius: 8 * unit, background: LIME }} />
        <div style={{ fontFamily: "Space Grotesk", fontSize: 34 * unit, fontWeight: 700 }}>trilio</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 * unit }}>
        <div style={{ fontFamily: "Space Grotesk", fontSize: 56 * unit, fontWeight: 700, lineHeight: 1.05 }}>
          {c.headline}
        </div>
        <div style={{ fontSize: 28 * unit, lineHeight: 1.3, color: STONE }}>{c.body}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 22 * unit, color: STONE }}>{coverage}</div>
        <div
          style={{
            background: LIME,
            color: NIGHT,
            fontWeight: 600,
            fontSize: 26 * unit,
            padding: `${12 * unit}px ${24 * unit}px`,
            borderRadius: 12 * unit,
          }}
        >
          trilio.lv
        </div>
      </div>
    </div>,
    { width: w, height: h, fonts: await brandFonts() },
  );
}

/** The square logo Performance Max requires. */
export async function renderLogo(): Promise<Response> {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: NIGHT,
      }}
    >
      <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 240, color: LIME }}>t</div>
    </div>,
    { width: 1200, height: 1200, fonts: await brandFonts() },
  );
}

const base64 = async (r: Response) => Buffer.from(await r.arrayBuffer()).toString("base64");

/** Approve an image: render it and upload it as an image asset. Video scripts are only approved. */
export async function approveCreative(
  db: Db,
  provider: AdsProvider,
  c: AdCreative,
): Promise<{ ok: boolean; error?: string }> {
  if (c.kind !== "image") {
    await db.update(adCreatives).set({ status: "approved" }).where(eq(adCreatives.id, c.id));
    return { ok: true };
  }
  const png = await renderCreative(c, await liveFacts(db, c.subcategoryId));
  const r = await send(db, provider, {
    op: "upload_image",
    name: `trilio-${c.subcategoryId}-${c.size}-${c.id.slice(0, 8)}`,
    pngBase64: await base64(png),
  });
  if (!r.ok) return { ok: false, error: r.error };
  await db
    .update(adCreatives)
    .set({ status: "uploaded", googleAssetId: r.id ?? null })
    .where(eq(adCreatives.id, c.id));
  return { ok: true };
}

/**
 * Performance Max for a category group (Phase 4), created paused: needs an
 * uploaded landscape and square image of one of its categories; the logo is
 * rendered and uploaded on the way. Search themes are the group's keywords.
 */
export async function createPmax(
  db: Db,
  provider: AdsProvider,
  groupId: string,
  budgetCents: number,
): Promise<{ ok: boolean; error?: string }> {
  if (groupId === COMPETITOR_GROUP) return { ok: false, error: "not for the competitor campaign" };
  const group = getGroupOfSubcategory(
    Object.keys(seed.subcategories).find((s) => getGroupOfSubcategory(s)?.id === groupId) ?? "",
  );
  if (!group) return { ok: false, error: "unknown group" };
  const subs = group.subcategories.map((s) => s.id);
  const uploaded = await db
    .select()
    .from(adCreatives)
    .where(and(inArray(adCreatives.subcategoryId, subs), eq(adCreatives.status, "uploaded")));
  const landscape = uploaded.find((c) => c.size === "1200x628");
  const square = uploaded.find((c) => c.size === "1200x1200");
  if (!landscape?.googleAssetId || !square?.googleAssetId)
    return { ok: false, error: "approve a 1200×628 and a 1200×1200 image of this group first" };
  const logo = await send(db, provider, {
    op: "upload_image",
    name: "trilio-logo",
    pngBase64: await base64(await renderLogo()),
  });
  if (!logo.ok) return { ok: false, error: logo.error };
  const keywords = await db
    .select({ text: adKeywords.text })
    .from(adKeywords)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adKeywords.campaignId))
    .where(and(eq(adCampaigns.groupId, groupId), eq(adKeywords.negative, false)));
  const name = `PMax · ${group.label}`;
  const headlines = [landscape.headline, "3 piemērotākie varianti", "Atbildi uz dažiem jautājumiem"].filter(
    (h, i, all) => all.indexOf(h) === i && lintAdText(h, "headline").length === 0,
  );
  const r = await send(db, provider, {
    op: "create_pmax",
    name,
    budgetCents,
    finalUrl: `${siteUrl()}/izvelies/${groupId}`,
    businessName: "Trilio",
    headlines:
      headlines.length >= 3
        ? headlines
        : [...headlines, "Salīdzini cenas veikalos", "Bez konta un bez maksas"].slice(0, 5),
    longHeadline: "Atbildi uz dažiem jautājumiem un saņem 3 piemērotākos variantus",
    descriptions: [landscape.body, "Secību nenosaka veikalu komisija. Redzi, kāpēc ieteikts katrs variants."],
    logo: logo.id!,
    landscape: landscape.googleAssetId,
    square: square.googleAssetId,
    searchThemes: keywords.map((k) => k.text),
  });
  if (!r.ok) return { ok: false, error: r.error };
  await db
    .insert(adCampaigns)
    .values({
      name,
      kind: "pmax",
      groupId,
      budgetCents,
      googleId: r.id ?? null,
      budgetGoogleId: r.budget ?? null,
      status: "paused",
      syncedAt: new Date(),
    })
    .onConflictDoNothing();
  return { ok: true };
}
