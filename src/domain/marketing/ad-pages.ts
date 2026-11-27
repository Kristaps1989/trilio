import { composePost, pickSlide, type PostCard, type PostFacts } from "@/domain/social/captions";
import { formatEur } from "@/i18n/format";

// The pictures of the agent's Meta ads (owner, 27 Nov 2026: 4:5 and 9:16 versions, a second
// variant, a product carousel and a Reel). Every page shows the category's three picks with
// their photos and today's prices, in Trilio's colours; nothing on them is invented. Pure:
// which pages, with which words. src/services/marketing/ad-pictures.ts draws them.

type Page = Omit<PostCard, "slides">;
type Picks = Extract<PostFacts, { kind: "picks" }>;

/** The four kinds of ad a category gets, each a separate ad in the agent's ad set. */
export const AD_FORMATS = ["collage", "collage_b", "carousel", "reel"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

const eur = (cents: number) => formatEur(cents, "lv");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Variant A: the photo collage on the light page, as the site's posts draw it. A carousel post
 * keeps its restyled first page in `slides[0]` and its old cover on the card itself, so the
 * first slide is taken. Anything but the collage with three photos throws.
 */
export function collagePage(facts: Picks, baseUrl: string): Page {
  const { card } = composePost(facts, { postId: "ad", baseUrl, design: "collage" });
  const { slides, ...single } = card;
  const page = slides?.[0] ?? single;
  if (page.layout !== "collage" || (page.images ?? []).length < 3)
    throw new Error("the ad's picture is not the photo collage");
  return page;
}

/**
 * Variant B: the same photos and prices on the night-green page, opening with the shopper's
 * question rather than the category's name. Meta shows both and keeps the one that brings e-mails.
 */
export function collageBPage(facts: Picks, baseUrl: string): Page {
  const a = collagePage(facts, baseUrl);
  return {
    ...a,
    theme: "night",
    eyebrow: lower(facts.category),
    headline: "Kurš der tieši tev?",
    sub: "3 piemēroti varianti šodienas cenās.",
  };
}

/**
 * One product's card: the posts' own product slide (captions.ts pickSlide): its photo large, its
 * tier and the "Labākā izvēle" pill, name, today's price and shop, key specs and what it gives
 * against the cheapest of the three. A product without a photo gets no card.
 */
export function productPage(facts: Picks, i: number): Page {
  const p = facts.picks[i];
  if (!p?.imageUrl) throw new Error(`no photo of pick ${i + 1}`);
  return pickSlide(facts.category, facts.picks, i, facts.subcategoryId);
}

/** The Reel's last page: what Trilio does, and where. */
export function closingPage(facts: Picks): Page {
  return {
    layout: "closing",
    chip: facts.category,
    title: "Atbildi uz dažiem jautājumiem.",
    lines: [{ main: "Atbildi uz dažiem jautājumiem. Redzi savus trīs." }],
    headline: "Atbildi uz dažiem jautājumiem.",
    headlineAccent: "Redzi savus trīs.",
    sub: "Vari arī pajautāt zemāku cenu.",
    icons: [facts.subcategoryId],
    buttons: ["trilio.lv"],
    plainFooter: true,
    subcategoryId: facts.subcategoryId,
  };
}

/** The Reel: the collage, each product in turn, and the closing page, drawn upright. */
export function reelCard(facts: Picks, baseUrl: string): PostCard {
  const cover = collagePage(facts, baseUrl);
  return {
    ...cover,
    slides: [cover, ...facts.picks.slice(0, 3).map((_, i) => productPage(facts, i)), closingPage(facts)],
  };
}

/** The headline under one carousel card and its line of description: the product and its price. */
export function cardText(facts: Picks, i: number): { name: string; description: string } {
  const p = facts.picks[i]!;
  return { name: p.name.slice(0, 40), description: `${eur(p.priceCents)} · ${p.shop}`.slice(0, 30) };
}
