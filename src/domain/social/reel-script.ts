import { formatEur } from "@/i18n/format";
import type { PickLine, PostCard, PostFacts } from "./captions";
import { bestPick, TAGLINE, TIER_NAME } from "./picks-words";
import { priceTrend, type PricePoint, type PriceTrend } from "./price-trend";

// The scenes the products are told in (owner, 28 Nov 2026: "focus on products and product
// analyses, price changes; a more modern design", and then the same for the picture ads, the
// carousel ads and the posts). Three picks open on their photos and today's prices; each product
// then gets a scene of its own: the photo, the price, the shop's price line over 30 days, what it
// does better and worse than the cheapest, its key specs. A comparison follows, then the call to
// action. The Reel plays them (reel.ts times them); a carousel post or ad shows them as slides.
// Pure: which scenes, with which words and numbers. src/services/social/reel-render.tsx draws them.

type Picks = Extract<PostFacts, { kind: "picks" }>;
type Top = Extract<PostFacts, { kind: "top_products" }>;
type Drop = Extract<PostFacts, { kind: "price_drop" }>;

export type ReelPick = {
  letter: string;
  name: string;
  image: string | null;
  price: string;
  priceCents: number;
  shop: string;
  tier: string | null;
  best: boolean;
  /** Its own category, for the drawing that stands in without a photo (top products mix them). */
  sub?: string;
};

export type ReelNote = { mark: "✓" | "+" | "−"; text: string };

export type ReelScene =
  | { kind: "hook"; eyebrow: string; headline: string; accent: string; picks: ReelPick[] }
  | {
      kind: "product";
      pick: ReelPick;
      /** Its place among the products (0-based) and how many there are. */
      index: number;
      total: number;
      trend: PriceTrend | null;
      /** ✓ for the cheapest's own strengths, + for what it gives over the cheapest, − for what it gives up. */
      notes: ReelNote[];
      specs: string[];
    }
  | { kind: "compare"; eyebrow: string; headline: string; rows: (ReelPick & { note: string | null })[] }
  | {
      kind: "cta";
      eyebrow: string;
      headline: string;
      accent: string;
      sub: string;
      button: string;
      /** The products' photos, small, above the button. */
      picks: ReelPick[];
    };

export type ReelScript = { category: string; subcategoryId: string; scenes: ReelScene[] };

const eur = (cents: number) => formatEur(cents, "lv");
const LETTERS = ["A", "B", "C"];

/** The words under a product: what the site's card says against the cheapest of the three. */
function notesOf(p: PickLine, picks: PickLine[]): ReelNote[] {
  const cheapest = picks.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
  const best = bestPick(picks);
  if (p === cheapest) {
    const out: ReelNote[] = [{ mark: "✓", text: "Zemākā cena no trim" }];
    if (best !== p && best.priceCents > p.priceCents)
      out.push({ mark: "✓", text: `Par ${eur(best.priceCents - p.priceCents)} lētāk nekā labākā izvēle` });
    return out;
  }
  return [
    ...(p.gains ?? []).slice(0, 3).map((text) => ({ mark: "+" as const, text })),
    ...(p.tradeoffs ?? []).slice(0, 1).map((text) => ({ mark: "−" as const, text })),
  ];
}

const specsOf = (specs: string | null | undefined) =>
  (specs ?? "")
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

/** A product's price line, when the day the prices are from is known and the history is long enough. */
const trendOf = (history: PricePoint[] | undefined, priceCents: number, today: string | null | undefined) =>
  today && history?.length ? priceTrend(history, priceCents, today) : null;

const cta = (eyebrow: string, picks: ReelPick[]): ReelScene => ({
  kind: "cta",
  eyebrow,
  headline: "Atbildi uz dažiem jautājumiem.",
  accent: "Redzi savus trīs.",
  sub: TAGLINE.split(". ").slice(-1)[0]!,
  button: "trilio.lv",
  picks,
});

/**
 * The scenes for three picks. `today` (YYYY-MM-DD, Riga) is the day the prices are from: the price
 * lines end on it; without it no line is drawn (facts saved before they carried their day).
 * Products without a photo still get their scene (the category's drawing stands in).
 */
export function reelScript(facts: Picks, today: string | null | undefined = facts.day): ReelScript {
  const picks = facts.picks.slice(0, 3);
  const best = bestPick(picks);
  const reelPicks: ReelPick[] = picks.map((p, i) => ({
    letter: LETTERS[i]!,
    name: p.name,
    image: p.imageUrl ?? null,
    price: eur(p.priceCents),
    priceCents: p.priceCents,
    shop: p.shop,
    tier: p.tier ? TIER_NAME[p.tier] : null,
    best: p === best && !!p.recommended,
  }));
  const trends = picks.map((p) => trendOf(p.history, p.priceCents, today));
  const anyTrend = trends.some(Boolean);
  const scenes: ReelScene[] = [
    {
      kind: "hook",
      eyebrow: facts.category,
      headline: `${picks.length} izvēles šodien.`,
      accent: anyTrend ? "Ar cenu 30 dienās." : "Salīdzinātas īsumā.",
      picks: reelPicks,
    },
    ...picks.map((p, i): ReelScene => ({
      kind: "product",
      pick: reelPicks[i]!,
      index: i,
      total: picks.length,
      trend: trends[i] ?? null,
      notes: notesOf(p, picks),
      specs: specsOf(p.specs),
    })),
    {
      kind: "compare",
      eyebrow: facts.category,
      headline: "Kuru izvēlēties?",
      rows: reelPicks.map((r, i) => ({ ...r, note: notesOf(picks[i]!, picks)[0]?.text ?? null })),
    },
    cta(facts.category, reelPicks),
  ];
  return { category: facts.category, subcategoryId: facts.subcategoryId, scenes };
}

/** The products people looked at most this week: the three, each in turn, and the call to action. */
export function topScript(facts: Top, today: string | null | undefined = facts.day): ReelScript {
  const items = facts.products.slice(0, 3);
  const picks: ReelPick[] = items.map((p, i) => ({
    letter: "",
    name: p.name,
    image: p.imageUrl ?? null,
    price: eur(p.priceCents),
    priceCents: p.priceCents,
    shop: p.shop,
    tier: `${i + 1}. vieta šonedēļ`,
    best: false,
    ...(p.subcategoryId ? { sub: p.subcategoryId } : {}),
  }));
  return {
    category: "Šonedēļ visvairāk interesēja",
    subcategoryId: items[0]?.subcategoryId ?? "",
    scenes: [
      {
        kind: "hook",
        eyebrow: "Šonedēļ visvairāk interesēja",
        headline: "Ko skatīja visvairāk.",
        accent: "Cenas šodien.",
        picks,
      },
      ...items.map((p, i): ReelScene => ({
        kind: "product",
        pick: picks[i]!,
        index: i,
        total: items.length,
        trend: trendOf(p.history, p.priceCents, today),
        notes: [],
        specs: specsOf(p.specs),
      })),
      cta("Trilio", picks),
    ],
  };
}

/** A price drop: the one product, its price line and what the drop is against. */
export function dropScene(f: Drop, today: string | null | undefined = f.day): ReelScene {
  const trend = trendOf(f.history, f.priceCents, today);
  return {
    kind: "product",
    pick: {
      letter: "",
      name: f.product,
      image: f.imageUrl ?? null,
      price: eur(f.priceCents),
      priceCents: f.priceCents,
      shop: f.shop,
      tier: "Cena samazinājās",
      best: false,
    },
    index: 0,
    total: 1,
    trend,
    // Said against the shop's own lowest price of the 30 days (Omnibus); once: the line's label
    // says it when there is a line.
    notes:
      !trend && f.lowCents > f.priceCents
        ? [{ mark: "✓", text: `Par ${eur(f.lowCents - f.priceCents)} zem zemākās cenas 30 dienās` }]
        : [],
    specs: [],
  };
}

/** The facts a scene's slide carries (prices to re-check before sending) and what it says aloud. */
function sceneFacts(s: ReelScene): Pick<PostCard, "chip" | "title" | "lines" | "alt"> {
  const line = (p: ReelPick) => ({ main: p.name, side: p.price, sub: p.shop });
  switch (s.kind) {
    case "hook":
      return {
        chip: s.eyebrow,
        title: `${s.headline} ${s.accent}`,
        lines: s.picks.map(line),
        alt: `${s.eyebrow}: ${s.picks.map((p) => `${p.name}, ${p.price}, ${p.shop}`).join("; ")}.`,
      };
    case "product":
      return {
        chip: s.pick.tier ?? s.pick.name,
        title: s.pick.name,
        lines: [line(s.pick)],
        alt: [
          `${s.pick.name}: ${s.pick.price}, ${s.pick.shop}.`,
          s.trend ? `${s.trend.label}.` : "",
          ...s.notes.map((n) => `${n.text}.`),
        ]
          .filter(Boolean)
          .join(" "),
      };
    case "compare":
      return {
        chip: s.eyebrow,
        title: s.headline,
        lines: s.rows.map(line),
        alt: `${s.headline} ${s.rows.map((r) => `${r.letter}: ${r.name}, ${r.price}`).join("; ")}.`,
      };
    case "cta":
      return {
        chip: s.eyebrow,
        title: s.headline,
        lines: [{ main: `${s.headline} ${s.accent}` }],
        alt: `${s.headline} ${s.accent} ${s.sub} ${s.button}`,
      };
  }
}

/** One scene as a slide (layout "scene"): drawn by the same code as the Reel, at the post's shape. */
export function sceneCard(script: ReelScript, i: number): Omit<PostCard, "slides"> {
  const scene = script.scenes[i]!;
  return { layout: "scene", ...sceneFacts(scene), scene, subcategoryId: script.subcategoryId };
}

/** Every scene as a slide, in order: a carousel post or ad. */
export const sceneCards = (script: ReelScript) => script.scenes.map((_, i) => sceneCard(script, i));
