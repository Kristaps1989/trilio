import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { z } from "zod";
import type { Db } from "@/db/client";
import { adCampaigns, adCreatives, adKeywords, type AdCreative } from "@/db/schema";
import { loadCandidates } from "@/db/queries/catalog";
import { COMPETITOR_GROUP } from "@/domain/ads/plan";
import { lintAdText } from "@/domain/ads/honesty";
import { eligibleOffers } from "@/domain/ranking/filters";
import { getGroupOfSubcategory, getSubcategory } from "@/domain/questions/catalog";
import { knowledgeOf } from "@/domain/knowledge/knowledge";
import { DRAWINGS } from "@/ui/illustrations/drawings";
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

export const Copy = z.object({
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
    body: "Atbildi uz pāris jautājumiem un saņem 3 piemērotākos variantus ar iemesliem.",
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
  pick: () => number = Math.random,
): Promise<CreativeCopy> {
  const facts = await liveFacts(db, subcategoryId);
  const fallback = templateCopy(subcategoryId);
  if (!caller) return fallback;
  const know = knowledgeOf(subcategoryId);
  // A different deciding factor on each press of "Ģenerēt", so drafts vary.
  const focus = Math.floor(pick() * Math.max(1, know.decides.length));
  const res = await caller({
    purpose: "ads_copy",
    model: OPTIMISER_MODEL,
    system: [
      "You write Latvian display and video ad copy for Trilio (trilio.lv). Trilio helps a shopper choose a household appliance: a few questions about their needs, then the three best options from partner shops' live stock, each with the reason it was picked.",
      "Write like a sharp local copywriter, not a brochure. Address the reader as 'tu'. Correct Latvian grammar and cases.",
      "headline (at most 30 characters): one concrete worry or wish a buyer of this category really has, built on the focus item of whatDecides, in everyday words. It must make sense on its own. Examples of the style (other categories; never reuse their wording): 'Tējkanna, kas nevārās mūžību', 'Putekļsūcējs, kas tiek zem gultas', 'Lai veļa nav jāgludina'. Bad (generic, never write these): 'Kurš ledusskapis tieši jums?', 'Atrodi labāko ledusskapi', 'Izvēlies gudri', anything with 'jums'.",
      "body (at most 90 characters): name two or three things Trilio weighs for this category (from whatDecides, as plain nouns, e.g. 'troksni, ietilpību un patēriņu'), then the promise: three options that fit you, with reasons. Do not start with 'Daži jautājumi'.",
      "video: 3–5 scenes of 2–5 seconds; onScreen at most 40 characters each; visual describes the shot in Latvian. Scene 1 shows the worry, the middle scenes the questions and the three result cards, the last scene 'trilio.lv'.",
      "Honest only: no 'cheapest', 'best price', 'guaranteed', discounts, percentages, urgency, superlatives about prices, shop or competitor names, and no numbers except numbersYouMayUse.",
    ].join("\n\n"),
    user: wrapUntrusted(
      "category",
      JSON.stringify({
        category: getSubcategory(subcategoryId)?.label,
        shortName: short(subcategoryId),
        whatDecides: know.decides.map((d) => d.why.lv),
        focus: know.decides[focus]?.why.lv ?? null,
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
export async function brandFonts() {
  if (fonts) return fonts;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const load = async (file: string) => readFile(path.join(dir, file));
  // One file per weight holding both Google subsets (latin + latin-ext):
  // satori keeps only the first font of a name and weight, so a separate
  // latin-ext file was ignored and ā, š, ķ fell back to a default font.
  fonts = [
    { name: "Space Grotesk", data: await load("space-grotesk-700.ttf"), weight: 700 },
    { name: "Figtree", data: await load("figtree-400.ttf"), weight: 400 },
    { name: "Figtree", data: await load("figtree-600.ttf"), weight: 600 },
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

/** The category's line drawing (src/ui/illustrations), stroked in night green. */
function Drawing({ subcategoryId, size }: { subcategoryId: string; size: number }) {
  const name = getSubcategory(subcategoryId)?.illustration;
  const drawing = name ? DRAWINGS[name] : undefined;
  if (!drawing) return <div style={{ display: "flex", width: size, height: size }} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke={NIGHT}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawing}
    </svg>
  );
}

/**
 * Three result cards as in the brand videos: good, better, best, with the
 * middle one ringed in lime. An illustration of how results look, with
 * price levels instead of prices, so the image never shows a stale number.
 */
function Podium({ subcategoryId, u }: { subcategoryId: string; u: number }) {
  const card = (label: string, price: string, main: boolean) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
        width: (main ? 170 : 140) * u,
        padding: `${(main ? 26 : 18) * u}px ${12 * u}px ${16 * u}px`,
        marginTop: main ? 0 : 28 * u,
        background: "#FFFFFF",
        borderRadius: 18 * u,
        border: main ? `${5 * u}px solid ${LIME}` : `${5 * u}px solid #FFFFFF`,
        color: NIGHT,
        opacity: main ? 1 : 0.92,
      }}
    >
      {main ? (
        <div
          style={{
            position: "absolute",
            top: -16 * u,
            background: LIME,
            color: NIGHT,
            fontSize: 15 * u,
            fontWeight: 600,
            padding: `${5 * u}px ${12 * u}px`,
            borderRadius: 99,
          }}
        >
          Labākā izvēle tev
        </div>
      ) : null}
      <Drawing subcategoryId={subcategoryId} size={(main ? 96 : 76) * u} />
      <div
        style={{
          fontFamily: "Space Grotesk",
          fontWeight: 700,
          fontSize: (main ? 26 : 21) * u,
          marginTop: 8 * u,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: (main ? 20 : 17) * u, color: "#4E605C", fontWeight: 600 }}>{price}</div>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: (main ? 30 : 24) * u,
          marginTop: 10 * u,
          borderRadius: 8 * u,
          background: main ? NIGHT : "#DDE5E2",
        }}
      />
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 * u }}>
      {card("Labs", "€", false)}
      {card("Labāks", "€€", true)}
      {card("Labākais", "€€€", false)}
    </div>
  );
}

function Wordmark({ u }: { u: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 * u }}>
      <LogoMark size={40 * u} />
      <div
        style={{ fontFamily: "Space Grotesk", fontSize: 34 * u, fontWeight: 700, letterSpacing: "-0.045em" }}
      >
        trilio
      </div>
    </div>
  );
}

function Cta({ u, label = "Sākt izvēli" }: { u: number; label?: string }) {
  return (
    <div
      style={{
        display: "flex",
        background: LIME,
        color: NIGHT,
        fontWeight: 600,
        fontSize: 26 * u,
        padding: `${14 * u}px ${28 * u}px`,
        borderRadius: 14 * u,
      }}
    >
      {label}
    </div>
  );
}

const glow = `radial-gradient(circle at 78% 55%, rgba(216,244,90,0.16) 0%, rgba(216,244,90,0) 45%), ${NIGHT}`;

/** The brand template (docs/BRAND.md) in the look of the brand videos: copy left, results right. */
export async function renderCreative(
  c: Pick<AdCreative, "headline" | "body" | "size" | "subcategoryId">,
  facts: { products: number; shops: number },
): Promise<Response> {
  const [w, h] = (c.size ?? "1200x628").split("x").map(Number) as [number, number];
  const coverage =
    facts.products > 0
      ? `Izskatām ${facts.products} preces ${facts.shops} ${facts.shops === 1 ? "veikalā" : "veikalos"}`
      : "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pieprasi labāku cenu.";
  const category = short(c.subcategoryId);
  const chip = (u: number) => (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        border: `${2 * u}px solid ${LIME}`,
        color: LIME,
        fontWeight: 600,
        fontSize: 20 * u,
        padding: `${6 * u}px ${16 * u}px`,
        borderRadius: 99,
      }}
    >
      {category}
    </div>
  );
  const frame = {
    width: "100%",
    height: "100%",
    display: "flex",
    background: glow,
    color: MIST,
    fontFamily: "Figtree",
  } as const;

  let body: ReactElement;
  if (w === 300) {
    // Small rectangle: logo, headline, cards, button. The body does not fit.
    const u = 0.42;
    body = (
      <div style={{ ...frame, flexDirection: "column", alignItems: "center", padding: 14, gap: 8 }}>
        <div
          style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}
        >
          <Wordmark u={0.5} />
          <div style={{ fontSize: 12, color: LIME, fontWeight: 600 }}>{category}</div>
        </div>
        <div
          style={{
            fontFamily: "Space Grotesk",
            fontWeight: 700,
            fontSize: 22,
            lineHeight: 1.1,
            textAlign: "center",
          }}
        >
          {c.headline}
        </div>
        <Podium subcategoryId={c.subcategoryId} u={u} />
        <Cta u={0.55} label="Sākt izvēli · trilio.lv" />
      </div>
    );
  } else if (w === h) {
    // Square: copy on top, the results row below, button at the foot.
    const u = 1.65;
    body = (
      <div style={{ ...frame, flexDirection: "column", justifyContent: "space-between", padding: 72 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Wordmark u={1.6} />
          {chip(1.6)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontFamily: "Space Grotesk", fontSize: 80, fontWeight: 700, lineHeight: 1.04 }}>
            {c.headline}
          </div>
          <div style={{ fontSize: 34, lineHeight: 1.3, color: STONE }}>{c.body}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 24 }}>
          <Podium subcategoryId={c.subcategoryId} u={u} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 30, color: STONE }}>{coverage}</div>
          <Cta u={1.6} />
        </div>
      </div>
    );
  } else {
    // Landscape: copy on the left, the results on the right.
    body = (
      <div style={{ ...frame, padding: 48, gap: 40 }}>
        <div
          style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 560 }}
        >
          <Wordmark u={1} />
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {chip(1)}
            <div style={{ fontFamily: "Space Grotesk", fontSize: 60, fontWeight: 700, lineHeight: 1.04 }}>
              {c.headline}
            </div>
            <div style={{ fontSize: 26, lineHeight: 1.35, color: STONE }}>{c.body}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <Cta u={1} />
            <div style={{ fontSize: 20, color: STONE, maxWidth: 300 }}>{coverage}</div>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Podium subcategoryId={c.subcategoryId} u={1.08} />
        </div>
      </div>
    );
  }
  return new ImageResponse(body, { width: w, height: h, fonts: await brandFonts() });
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
      <LogoMark size={800} />
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
