import { formatEur } from "@/i18n/format";
import { bestPick, TAGLINE, type PickLine, type PostFacts } from "./captions";
import { priceTrend, type PriceTrend } from "./price-trend";

// The scenes of a generated Reel about three picks (owner, 28 Nov 2026: "focus on products and
// product analyses, price changes; a more modern design"). It is a short film made for video,
// not the carousel's slides played in a row. It opens on the three photos and today's prices,
// then gives each product a scene of its own: the photo large, the price, the shop's price line
// over 30 days, what it does better and worse than the cheapest, and its key specs. A comparison
// follows, then the call to action. Pure: which scenes, with which words and numbers.
// src/services/social/reel-render.tsx draws them; src/domain/social/reel.ts times them.

type Picks = Extract<PostFacts, { kind: "picks" }>;

export type ReelPick = {
  letter: string;
  name: string;
  image: string | null;
  price: string;
  priceCents: number;
  shop: string;
  tier: string | null;
  best: boolean;
};

export type ReelScene =
  | { kind: "hook"; eyebrow: string; headline: string; accent: string; picks: ReelPick[] }
  | {
      kind: "product";
      pick: ReelPick;
      /** Its place among the products (0-based) and how many there are, for the progress marks. */
      index: number;
      total: number;
      trend: PriceTrend | null;
      /** ✓ for the cheapest's own strengths, + for what it gives over the cheapest, − for what it gives up. */
      notes: { mark: "✓" | "+" | "−"; text: string }[];
      specs: string[];
    }
  | { kind: "compare"; eyebrow: string; headline: string; rows: (ReelPick & { note: string | null })[] }
  | { kind: "cta"; eyebrow: string; headline: string; accent: string; sub: string; button: string };

export type ReelScript = { category: string; subcategoryId: string; scenes: ReelScene[] };

const TIER_NAME = { budget: "Budžeta variants", mid: "Vidējā klase", top: "Augstākā klase" } as const;
const eur = (cents: number) => formatEur(cents, "lv");

/** The words under a product: the same lines the carousel's product slide shows (captions.ts pickSlide). */
function notesOf(p: PickLine, picks: PickLine[]): { mark: "✓" | "+" | "−"; text: string }[] {
  const cheapest = picks.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
  const best = bestPick(picks);
  if (p === cheapest) {
    const out: { mark: "✓"; text: string }[] = [{ mark: "✓", text: "Zemākā cena no trim" }];
    if (best !== p && best.priceCents > p.priceCents)
      out.push({ mark: "✓", text: `Par ${eur(best.priceCents - p.priceCents)} lētāk nekā labākā izvēle` });
    return out;
  }
  return [
    ...(p.gains ?? []).slice(0, 3).map((text) => ({ mark: "+" as const, text })),
    ...(p.tradeoffs ?? []).slice(0, 1).map((text) => ({ mark: "−" as const, text })),
  ];
}

/**
 * The Reel's scenes for these picks. `today` (YYYY-MM-DD, Riga) is the day the prices are
 * from: the price line ends on it. Products without a photo still get their scene (the
 * category's drawing stands in), so the three are always told.
 */
export function reelScript(facts: Picks, today: string): ReelScript {
  const picks = facts.picks.slice(0, 3);
  const best = bestPick(picks);
  const reelPicks: ReelPick[] = picks.map((p, i) => ({
    letter: ["A", "B", "C"][i]!,
    name: p.name,
    image: p.imageUrl ?? null,
    price: eur(p.priceCents),
    priceCents: p.priceCents,
    shop: p.shop,
    tier: p.tier ? TIER_NAME[p.tier] : null,
    best: p === best && !!p.recommended,
  }));
  const trends = picks.map((p) => (p.history?.length ? priceTrend(p.history, p.priceCents, today) : null));
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
      specs: (p.specs ?? "")
        .split(" · ")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4),
    })),
    {
      kind: "compare",
      eyebrow: facts.category,
      headline: "Kuru izvēlēties?",
      rows: reelPicks.map((r, i) => ({ ...r, note: notesOf(picks[i]!, picks)[0]?.text ?? null })),
    },
    {
      kind: "cta",
      eyebrow: facts.category,
      headline: "Atbildi uz dažiem jautājumiem.",
      accent: "Redzi savus trīs.",
      sub: TAGLINE.split(". ").slice(-1)[0]!,
      button: "trilio.lv",
    },
  ];
  return { category: facts.category, subcategoryId: facts.subcategoryId, scenes };
}
