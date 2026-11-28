import type { PostCard, PostFacts } from "@/domain/social/captions";
import { reelScript, sceneCard } from "@/domain/social/reel-script";
import { formatEur } from "@/i18n/format";

// The pictures of the agent's Meta ads (owner, 27 Nov 2026: 4:5 and 9:16 versions, a second
// variant, a product carousel and a Reel; 28 Nov 2026: the products told as the Reel tells them,
// in the picture ads and the carousel too). Every page is a scene of reel-script.ts: the three
// photos with today's prices, each product with its price line over 30 days and what it gives,
// the comparison. Nothing on them is invented. Pure: which pages, with which words.

type Page = Omit<PostCard, "slides">;
type Picks = Extract<PostFacts, { kind: "picks" }>;

/** The four kinds of ad a category gets, each a separate ad in the agent's ad set. */
export const AD_FORMATS = ["collage", "collage_b", "carousel", "reel"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

const eur = (cents: number) => formatEur(cents, "lv");

/** Variant A: the three products' photos with today's prices (the scenes' opening). */
export function collagePage(facts: Picks): Page {
  return sceneCard(reelScript(facts), 0);
}

/**
 * Variant B: the comparison, opening with the shopper's question ("Kuru izvēlēties?"): the three
 * side by side with their prices and what each gives. Meta shows both and keeps the one that
 * brings e-mails.
 */
export function collageBPage(facts: Picks): Page {
  const script = reelScript(facts);
  return sceneCard(
    script,
    script.scenes.findIndex((s) => s.kind === "compare"),
  );
}

/**
 * One product's card: its scene, the photo, today's price and shop, the price line over 30 days
 * and what it gives against the cheapest. A product without a photo gets no card.
 */
export function productPage(facts: Picks, i: number): Page {
  const p = facts.picks[i];
  if (!p?.imageUrl) throw new Error(`no photo of pick ${i + 1}`);
  return sceneCard(reelScript(facts), 1 + i);
}

/** The Reel: the same scenes, played (reel.ts times them). */
export function reelCard(facts: Picks, today?: string): PostCard {
  const script = reelScript(facts, today ?? facts.day);
  return { ...sceneCard(script, 0), reel: script };
}

/** The headline under one carousel card and its line of description: the product and its price. */
export function cardText(facts: Picks, i: number): { name: string; description: string } {
  const p = facts.picks[i]!;
  return { name: p.name.slice(0, 40), description: `${eur(p.priceCents)} · ${p.shop}`.slice(0, 30) };
}
