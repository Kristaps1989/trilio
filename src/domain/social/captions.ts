import type { SocialKind } from "@/db/schema";
import { formatEur } from "@/i18n/format";
import { OFFER_DISCOUNT_UP_TO_PCT, maxOfferSavingCents } from "@/domain/offers/discount";
import { lintPost, ownerTextBlocks, type PostLintContext } from "./lint";

// The words of each post type (docs/SOCIAL_PLAN.md §3), from facts the job
// queried a moment before. Register (§6, owner D1): no "tu" and no "jūs" in
// captions; statements and infinitives. Every number comes from the facts,
// and `composePost` refuses a caption the lint does not pass.

/** `imageUrl`: the product's photo from the shop's feed (an https URL on a partner host), when it has one. */
export type PickLine = {
  name: string;
  priceCents: number;
  shop: string;
  imageUrl?: string | null;
  /** The ranking's tier and its one recommended pick ("Labākā izvēle"), as the results page shows them. */
  tier?: "budget" | "mid" | "top" | null;
  recommended?: boolean;
  /** Its key specs in one line ("60 cm · 13 komplekti · 44 dB · C"), as on the site's card. */
  specs?: string | null;
  /** What it gives, and does worse, than the cheapest of the three, in the site's words. */
  gains?: string[];
  tradeoffs?: string[];
};

export type PostFacts =
  | {
      kind: "picks";
      subcategoryId: string;
      category: string;
      picks: PickLine[];
      /** The flow's first questions as the site asks them, for the carousel (no answers are invented). */
      questions?: { title: string; options: string[] }[];
      path: string;
    }
  | {
      kind: "price_drop";
      subcategoryId: string;
      productId: string;
      product: string;
      priceCents: number;
      lowCents: number;
      shop: string;
      imageUrl?: string | null;
      path: string;
    }
  | { kind: "advice"; subcategoryId: string; category: string; factor: string; path: string }
  | {
      kind: "offer";
      specialOfferId: string;
      subcategoryId: string;
      product: string;
      shop: string | null;
      shopPriceCents: number | null;
      trilioPriceCents: number;
      deliveryDays: number;
      month: string;
      imageUrl?: string | null;
      path: string;
    }
  | {
      kind: "top_categories";
      /** `fromCents`: the lowest current price in the category, for its slide; `path`: its flow. */
      categories: { id: string; label: string; fromCents?: number | null; path?: string }[];
      path: string;
    }
  | {
      kind: "top_products";
      products: (PickLine & { id: string; subcategoryId?: string; path?: string })[];
      path: string;
    }
  | {
      kind: "reel";
      caption: string;
      videoUrl: string;
      path: string;
      /**
       * A Reel Trilio makes itself (docs/SOCIAL_PLAN.md §14): the facts its slides and its
       * caption are made from, so the prices in it are checked like any other post's.
       */
      of?: Exclude<PostFacts, { kind: "reel" }>;
    };

export type CardLine = {
  main: string;
  side?: string;
  sub?: string;
  /** A question's options, drawn as pills. */
  chips?: string[];
  /** The card's buttons, as on the site: the first dark, the rest outlined. */
  buttons?: string[];
};

/** A phone mock-up's screen: the site as it looks, drawn in the image. */
export type PhoneScreen =
  | { kind: "questions"; questions: { title: string; options: string[] }[] }
  | { kind: "picks"; picks: { name: string; shop: string; price: string; best?: boolean }[] }
  | {
      kind: "card";
      name: string;
      shop: string;
      price: string;
      buttons: string[];
      note: string;
      /** The site's "līdz −10 %" strip under the request (docs/PRICE_NOTIFY_PLAN.md §8.7). */
      strip?: { upTo: string; saving: string };
      /** The product's photo on the card, as on the site. */
      image?: string;
    };

/**
 * What the image shows (src/services/social/render.tsx draws it). `lines`
 * stay the facts (prices to re-check, names the lint allows); the layout
 * fields say how the slide is composed: one idea per slide, a large
 * headline, one hero element (a numeral, a price, a phone, an illustration).
 */
export type PostCard = {
  chip: string;
  title: string;
  lines: CardLine[];
  note?: string;
  subcategoryId?: string;
  layout?:
    | "cover"
    | "rank"
    | "phone"
    | "statement"
    | "drop"
    | "product"
    | "offer"
    | "closing"
    // The themed designs (docs/SOCIAL_PLAN.md §14): a big figure, product photos scattered
    // on the page, a question with its answers, and a photo of people at home.
    | "big"
    | "collage"
    | "ask"
    | "people"
    // One product of the three: its photo large, its tier, specs, price and what it gives.
    | "pick";
  /** The page's colours: night green (default), lime, or light. Only the themed designs use it. */
  theme?: SocialTheme;
  /** "collage": the products' photos, in order. */
  images?: string[];
  /** "ask": the answers under the question, lettered A, B, C. */
  options?: { label: string; side?: string }[];
  /** "people": who took the stock photo, kept with the post (never shown as a customer). */
  credit?: string;
  /** Which of the kind's designs the post was drawn in, so a refresh of its prices keeps it. */
  design?: Design;
  /** Small capitals in lime above the headline. */
  eyebrow?: string;
  /** A lime pill beside the eyebrow: "Labākā izvēle" on the ranking's recommended pick. */
  badge?: string;
  /** The headline; `title` when absent. A second part in lime. */
  headline?: string;
  headlineAccent?: string;
  /** Under the headline, one sentence. */
  sub?: string;
  /** "01": the hero of a rank slide. */
  numeral?: string;
  /** The one figure of a slide: "499 €" with its label; and a second, smaller one. */
  stat?: { label: string; value: string };
  stat2?: { label: string; value: string };
  /** Typographic rows: numeral, label, a figure on the right. */
  rows?: { n: string; label: string; side?: string }[];
  phone?: PhoneScreen;
  /** The site's buttons: the first is primary. */
  buttons?: string[];
  /** A large illustration as the hero, for a category. */
  hero?: string;
  /** The product's photo (an https URL on a partner host) as the hero; `hero` is drawn when it cannot be fetched. */
  image?: string;
  /** A carousel: every slide is a card of its own; `lines` above stay the facts to re-check. */
  slides?: Omit<PostCard, "slides">[];
  /** The slide's own alt text (keywords: category, product, price); made from its content when absent. */
  alt?: string;
  /** Category illustrations in a row under the title. */
  icons?: string[];
  /** The closing slide says the line itself, so the footer shows trilio.lv only. */
  plainFooter?: boolean;
  /** The site page this slide's card opens in a Facebook link carousel; the post's own page when absent. */
  link?: string;
};

/** Alt text for a slide from what it shows: the words people search for, nothing invented. */
export function slideAlt(c: Omit<PostCard, "slides">): string {
  if (c.alt) return c.alt;
  const lines = c.lines.map((l) => [l.main, l.side, l.sub, ...(l.chips ?? [])].filter(Boolean).join(", "));
  return [c.title, ...lines].filter(Boolean).join(". ").slice(0, 900);
}

export type SocialTheme = "night" | "lime" | "light";

/** A stock photo of people at home, from data/social-photos.json: lifestyle only, never a customer. */
export type PeoplePhoto = { url: string; credit: string };

/**
 * The designs a kind rotates through (docs/SOCIAL_PLAN.md §14), so two posts of a kind in a
 * row never look alike. "classic" is the night-green design the posts began with.
 */
export type Design = "classic" | "big" | "collage" | "ask" | "people";
export const DESIGNS: Record<Exclude<SocialKind, "reel">, Design[]> = {
  picks: ["collage", "ask", "classic"],
  price_drop: ["big", "classic"],
  // Two dark designs (the photo and the classic) never follow each other: lime sits between them.
  advice: ["people", "ask", "classic", "ask"],
  offer: ["big", "classic"],
  top_categories: ["ask", "classic"],
  top_products: ["collage", "classic"],
};
const DESIGN_THEME: Record<Design, SocialTheme> = {
  classic: "night",
  big: "lime",
  collage: "light",
  ask: "lime",
  people: "night",
};

/** The design the n-th post of a kind gets, and the theme it shows. */
export function designOf(kind: SocialKind, variant: number): { design: Design; theme: SocialTheme } {
  const list = kind === "reel" ? (["collage", "ask", "classic"] as Design[]) : DESIGNS[kind];
  const design = list[((variant % list.length) + list.length) % list.length]!;
  return { design, theme: DESIGN_THEME[design] };
}

const minus = (cents: number) => `−${eur(cents)}`;

/**
 * Redraws the post's first picture in the chosen design. The facts (`lines`), the captions and
 * the other slides stay as they are: only how the cover looks changes. A design that the facts
 * cannot fill (no shop price to compare, no photo of people) falls back to the classic one.
 */
export function restyle(card: PostCard, f: PostFacts, design: Design, photo?: PeoplePhoto | null): PostCard {
  if (f.kind === "reel") return f.of ? restyle(card, f.of, design, photo) : card;
  if (design === "classic") return card;
  const cover: Omit<PostCard, "slides"> = card.slides?.[0] ?? card;
  let next: Omit<PostCard, "slides"> | null = null;
  const base = { chip: cover.chip, title: cover.title, lines: cover.lines, note: cover.note };
  if (design === "big" && f.kind === "price_drop" && f.lowCents > f.priceCents)
    next = {
      ...base,
      layout: "big",
      theme: "lime",
      eyebrow: "Cena samazinājās",
      numeral: minus(f.lowCents - f.priceCents),
      headline: "zem zemākās cenas pēdējās 30 dienās.",
      sub: f.product,
      hero: f.subcategoryId,
      ...(f.imageUrl ? { image: f.imageUrl } : {}),
      stat: { label: `Tagad · ${f.shop}`, value: eur(f.priceCents) },
      stat2: { label: "Zemākā cena 30 dienās", value: eur(f.lowCents) },
      subcategoryId: f.subcategoryId,
    };
  else if (
    design === "big" &&
    f.kind === "offer" &&
    f.shopPriceCents !== null &&
    f.shopPriceCents > f.trilioPriceCents
  )
    next = {
      ...base,
      layout: "big",
      theme: "lime",
      eyebrow: `Reāls piemērs · ${f.month}`,
      numeral: minus(f.shopPriceCents - f.trilioPriceCents),
      headline: "lētāk nekā veikalā.",
      sub: f.product,
      hero: f.subcategoryId,
      ...(f.imageUrl ? { image: f.imageUrl } : {}),
      stat: { label: "Trilio piedāvājums", value: eur(f.trilioPriceCents) },
      stat2: { label: `Veikalā${f.shop ? ` ${f.shop}` : ""}`, value: eur(f.shopPriceCents) },
      subcategoryId: f.subcategoryId,
    };
  else if (design === "collage" && (f.kind === "picks" || f.kind === "top_products")) {
    const items = f.kind === "picks" ? f.picks : f.products;
    const images = items.map((p) => p.imageUrl).filter((u): u is string => !!u);
    if (images.length >= 2)
      next = {
        ...base,
        layout: "collage",
        theme: "light",
        eyebrow: f.kind === "picks" ? "3 ieteikumi" : "Šonedēļ skatītākās",
        headline: f.kind === "picks" ? f.category : "Ko skatās visvairāk",
        sub: "Cenas šodien partneru veikalos.",
        images: images.slice(0, 4),
        rows: items.slice(0, 3).map((p, i) => ({ n: `0${i + 1}`, label: p.name, side: eur(p.priceCents) })),
        ...(f.kind === "picks" ? { subcategoryId: f.subcategoryId, hero: f.subcategoryId } : {}),
      };
  } else if (design === "ask" && f.kind === "picks")
    next = {
      ...base,
      layout: "ask",
      theme: "lime",
      eyebrow: lower(f.category),
      headline: "Nezini, kuru izvēlēties?",
      sub: "Trīs piemērotākie varianti; cenas šodien partneru veikalos.",
      options: f.picks.slice(0, 3).map((p) => ({ label: p.name, side: eur(p.priceCents) })),
      subcategoryId: f.subcategoryId,
      hero: f.subcategoryId,
    };
  else if (design === "ask" && f.kind === "top_categories")
    next = {
      ...base,
      layout: "ask",
      theme: "lime",
      eyebrow: "Ko meklē šonedēļ",
      headline: "Ko Latvija meklēja šonedēļ?",
      sub: "Trilio lietotāju meklētākās kategorijas pēc kārtas.",
      options: f.categories.slice(0, 4).map((c) => ({ label: c.label })),
    };
  else if (design === "ask" && f.kind === "advice")
    next = {
      ...base,
      layout: "ask",
      theme: "lime",
      eyebrow: `Kā izvēlēties · ${lower(f.category)}`,
      headline: f.factor,
      sub: "Daži jautājumi, un trīs piemērotākie varianti.",
      subcategoryId: f.subcategoryId,
      hero: f.subcategoryId,
    };
  else if (design === "people" && f.kind === "advice" && photo)
    next = {
      ...base,
      layout: "people",
      theme: "night",
      eyebrow: `Kā izvēlēties · ${lower(f.category)}`,
      headline: f.factor,
      sub: "Daži jautājumi, un trīs piemērotākie varianti.",
      image: photo.url,
      credit: photo.credit,
      subcategoryId: f.subcategoryId,
      hero: f.subcategoryId,
    };
  if (!next) return card;
  if (cover.alt) next.alt = cover.alt;
  if (cover.link) next.link = cover.link;
  return card.slides?.length ? { ...card, slides: [next, ...card.slides.slice(1)] } : { ...next };
}

export type ComposedPost = {
  card: PostCard;
  captionFb: string;
  captionIg: string;
  alt: string;
  /** The page the post links to, with the UTM tags (§7). */
  link: string;
  issues: string[];
};

export const TAGLINE = "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pajautā zemāku cenu.";

const eur = (cents: number) => formatEur(cents, "lv");

const TIER_NAME = { budget: "Budžeta variants", mid: "Vidējā klase", top: "Augstākā klase" } as const;
export const BEST_LABEL = "Labākā izvēle";

/** The pick the site recommends ("Labākā izvēle"); the first when the ranking marks none. */
export function bestPick(picks: PickLine[]): PickLine {
  return picks.find((p) => p.recommended) ?? picks[0]!;
}

/**
 * One of the three as a slide of its own (owner, 27 Nov 2026: each product's strengths, its photo
 * large): its letter and tier, the name, today's price and shop, the key specs, and what it gives
 * and does worse than the cheapest of the three, in the results page's own words. The cheapest
 * says what it saves against the recommended one. Nothing here is not in the data.
 */
export function pickSlide(
  category: string,
  picks: PickLine[],
  i: number,
  subcategoryId?: string,
): Omit<PostCard, "slides"> {
  const p = picks[i]!;
  const cheapest = picks.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
  const best = bestPick(picks);
  const rows: { n: string; label: string }[] = [];
  if (p === cheapest) {
    rows.push({ n: "✓", label: "Zemākā cena no trim" });
    if (best !== p && best.priceCents > p.priceCents)
      rows.push({ n: "✓", label: `Par ${eur(best.priceCents - p.priceCents)} lētāk nekā labākā izvēle` });
  } else {
    for (const g of (p.gains ?? []).slice(0, 3)) rows.push({ n: "+", label: g });
    for (const t of (p.tradeoffs ?? []).slice(0, 1)) rows.push({ n: "−", label: t });
  }
  const tier = p.tier ? TIER_NAME[p.tier] : null;
  return {
    layout: "pick",
    chip: category,
    title: p.name,
    eyebrow: [["A", "B", "C"][i] ?? String(i + 1), tier ?? category].join(" · "),
    ...(p.recommended ? { badge: BEST_LABEL } : {}),
    headline: p.name,
    ...(p.specs ? { sub: p.specs } : {}),
    stat: { label: `Cena šodien · ${p.shop}`, value: eur(p.priceCents) },
    ...(rows.length ? { rows } : {}),
    ...(p.imageUrl ? { image: p.imageUrl } : {}),
    lines: [{ main: p.name, side: eur(p.priceCents), sub: p.shop }],
    alt: `${category}: ${p.name}, ${eur(p.priceCents)}, ${p.shop}.${p.specs ? ` ${p.specs}.` : ""}`,
    ...(subcategoryId ? { subcategoryId } : {}),
  };
}

const CATEGORY_TAGS: Record<string, string> = {
  fridge: "#ledusskapis",
  freezer: "#saldētava",
  washer: "#veļasmašīna",
  dryer: "#veļasžāvētājs",
  dish: "#traukumazgājamāmašīna",
  oven: "#cepeškrāsns",
  hob: "#plīts",
  hood: "#tvaikunosūcējs",
  micro: "#mikroviļņukrāsns",
  vacuum: "#putekļsūcējs",
  coffee: "#kafijasaparāts",
  kettle: "#tējkanna",
};

/** Five tags from a fixed list: Instagram captions cannot link, tags carry the reach. */
export function hashtags(subcategoryId?: string): string[] {
  const own = subcategoryId ? CATEGORY_TAGS[subcategoryId] : undefined;
  return [...(own ? [own] : []), "#trilio", "#sadzīvestehnika", "#mājai", "#latvija", "#iepirkšanās"].slice(
    0,
    5,
  );
}

export function utmLink(
  baseUrl: string,
  path: string,
  network: "facebook" | "instagram",
  kind: SocialKind,
  postId: string,
) {
  const sep = path.includes("?") ? "&" : "?";
  return `${baseUrl}${path}${sep}utm_source=${network}&utm_medium=social&utm_campaign=${kind}&utm_content=${postId}`;
}

const ORDER = ["1.", "2.", "3.", "4.", "5."];
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Body text, image and alt for a kind; the CTA line and the link are added by composePost. */
function parts(
  f: PostFacts,
  lead?: string,
): {
  body: string[];
  cta: string;
  card: PostCard;
  alt: string;
  prices: number[];
  numbers: number[];
  names: string[];
  sub?: string;
} {
  switch (f.kind) {
    case "picks": {
      const head = lead ?? `Trīs ieteikumi: ${lower(f.category)}.`;
      const questions = (f.questions ?? []).slice(0, 3);
      // Step 3 shows the pick the site recommends, as step 2 marks it (not simply the cheapest).
      const first = bestPick(f.picks);
      const pickLines = f.picks.map((p) => ({ main: p.name, side: eur(p.priceCents), sub: p.shop }));
      const slides: PostCard["slides"] = questions.length
        ? [
            {
              layout: "cover",
              chip: "Izvēle 3 soļos",
              eyebrow: lower(f.category),
              title: f.category,
              headline: "Daži jautājumi.",
              headlineAccent: "Trīs ieteikumi.",
              sub: "Kā tas notiek: trīs soļi, trīs bildes.",
              hero: f.subcategoryId,
              rows: [
                { n: "01", label: "Daži jautājumi" },
                { n: "02", label: "Trīs piemērotākie varianti" },
                { n: "03", label: "Pērc uzreiz vai pajautā zemāku cenu" },
              ],
              lines: [
                { main: "1. Daži jautājumi" },
                { main: "2. Trīs ieteikumi" },
                { main: "3. Pērc uzreiz vai pajautā zemāku cenu" },
              ],
              subcategoryId: f.subcategoryId,
            },
            {
              layout: "phone",
              chip: "1. solis",
              eyebrow: "1. solis",
              title: "Daži jautājumi",
              headline: "Daži jautājumi.",
              sub: "Tikai tie, kas izšķir izvēli.",
              phone: {
                kind: "questions",
                questions: questions.map((q) => ({ title: q.title, options: q.options.slice(0, 4) })),
              },
              lines: questions.map((q) => ({ main: q.title, chips: q.options.slice(0, 4) })),
              note: "Tikai tas, kas izšķir izvēli",
            },
            {
              layout: "phone",
              chip: "2. solis",
              eyebrow: "2. solis",
              title: "Trīs ieteikumi",
              headline: "Trīs ieteikumi.",
              sub: "Piemērs bez atbildēm; cenas šodien partneru veikalos.",
              phone: {
                kind: "picks",
                picks: f.picks.map((p) => ({
                  name: p.name,
                  shop: p.shop,
                  price: eur(p.priceCents),
                  best: p === bestPick(f.picks),
                })),
              },
              lines: pickLines,
              note: "Piemērs bez atbildēm; cenas šodien partneru veikalos",
            },
            ...f.picks.slice(0, 3).map((_, i) => pickSlide(f.category, f.picks, i, f.subcategoryId)),
            {
              layout: "phone",
              chip: "3. solis",
              eyebrow: "3. solis",
              title: "Pērc uzreiz vai pajautā zemāku cenu",
              headline: "Pērc uzreiz.",
              headlineAccent: "Vai pajautā zemāku cenu.",
              sub: "Ja izplatītājs piedāvās zemāku cenu, atsūtīsim piedāvājumu. Ja ne, paziņosim, kad cena samazināsies.",
              phone: {
                kind: "card",
                name: first.name,
                shop: first.shop,
                price: eur(first.priceCents),
                buttons: ["Iegūt lētāk", `Pirkt — ${first.shop}`],
                // The site's card after the tap: the discount, then the fine print.
                ...(maxOfferSavingCents(first.priceCents) > 0
                  ? {
                      strip: {
                        upTo: `līdz −${OFFER_DISCOUNT_UP_TO_PCT} %`,
                        saving: eur(maxOfferSavingCents(first.priceCents)),
                      },
                    }
                  : {}),
                note: "Zemāku cenu ne vienmēr izdodas panākt.",
                ...(first.imageUrl ? { image: first.imageUrl } : {}),
              },
              lines: [
                {
                  main: first.name,
                  side: eur(first.priceCents),
                  sub: first.shop,
                  buttons: ["Iegūt lētāk", `Pirkt — ${first.shop}`],
                },
              ],
              note: "Ja izplatītājs piedāvās zemāku cenu, atsūtīsim piedāvājumu. Ja ne, paziņosim, kad cena samazināsies.",
            },
          ]
        : undefined;
      return {
        body: [
          head,
          f.picks.map((p, i) => `${ORDER[i]} ${p.name} — ${eur(p.priceCents)} (${p.shop})`).join("\n"),
          slides
            ? "Cenas šodien partneru veikalos. Kā tas notiek, redzams bildēs: daži jautājumi, trīs ieteikumi, tad pirkt uzreiz vai pajautāt zemāku cenu."
            : "Cenas šodien partneru veikalos.",
        ],
        cta: "Var pirkt uzreiz veikalā vai spiest „Iegūt lētāk”: tad sazināsimies ar izplatītāju.",
        card: {
          layout: "cover",
          chip: "3 ieteikumi",
          eyebrow: "3 ieteikumi",
          title: f.category,
          headline: f.category,
          sub: "Cenas šodien partneru veikalos.",
          hero: f.subcategoryId,
          rows: f.picks.map((p, i) => ({ n: `0${i + 1}`, label: p.name, side: eur(p.priceCents) })),
          lines: pickLines,
          note: "Cenas šodien partneru veikalos",
          subcategoryId: f.subcategoryId,
          ...(slides ? { slides } : {}),
        },
        alt: `${slides ? "Izvēle 3 soļos. " : ""}Trīs ieteikumi: ${f.category}. ${f.picks.map((p) => `${p.name}, ${eur(p.priceCents)}`).join("; ")}.`,
        prices: f.picks.map((p) => p.priceCents),
        numbers: [],
        names: f.picks.flatMap((p) => [p.name, p.shop]),
        sub: f.subcategoryId,
      };
    }
    case "price_drop":
      return {
        body: [
          `${f.product} tagad maksā ${eur(f.priceCents)} (${f.shop}).`,
          `Pēdējās 30 dienās zemākā cena šajā veikalā bija ${eur(f.lowCents)}.`,
        ],
        cta: "Cenu vēsture un trīs alternatīvas pēc dažiem jautājumiem:",
        card: {
          layout: "drop",
          chip: "Cena samazinājās",
          eyebrow: "Cena samazinājās",
          title: f.product,
          headline: f.product,
          hero: f.subcategoryId,
          ...(f.imageUrl ? { image: f.imageUrl } : {}),
          stat: { label: `Tagad · ${f.shop}`, value: eur(f.priceCents) },
          stat2: { label: "Zemākā cena pēdējās 30 dienās", value: eur(f.lowCents) },
          sub: "Salīdzināts ar šī veikala zemāko cenu pēdējās 30 dienās.",
          lines: [
            { main: "Tagad", side: eur(f.priceCents), sub: f.shop },
            { main: "Zemākā cena pēdējās 30 dienās", side: eur(f.lowCents) },
          ],
          note: "Salīdzināts ar zemāko cenu pēdējās 30 dienās (Omnibus)",
          subcategoryId: f.subcategoryId,
        },
        alt: `${f.product}: tagad ${eur(f.priceCents)} veikalā ${f.shop}, zemākā cena pēdējās 30 dienās ${eur(f.lowCents)}.`,
        prices: [f.priceCents, f.lowCents],
        numbers: [30],
        names: [f.product, f.shop],
        sub: f.subcategoryId,
      };
    case "advice":
      return {
        body: [lead ?? `${f.category}: kas izšķir izvēli.`, f.factor],
        cta: "Pārējo izvērtē daži jautājumi, un pēc tiem trīs piemērotākie varianti:",
        card: {
          layout: "statement",
          chip: "Kā izvēlēties",
          eyebrow: `Kā izvēlēties · ${lower(f.category)}`,
          title: f.category,
          headline: f.factor,
          hero: f.subcategoryId,
          lines: [{ main: f.factor }],
          subcategoryId: f.subcategoryId,
        },
        alt: `${f.category}: ${f.factor}`,
        prices: [],
        numbers: [...f.factor.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", "."))),
        names: [],
        sub: f.subcategoryId,
      };
    case "offer": {
      const shopLine =
        f.shopPriceCents !== null
          ? `Veikalā${f.shop ? ` ${f.shop}` : ""} tā maksāja ${eur(f.shopPriceCents)}, Trilio piedāvāja ${eur(f.trilioPriceCents)}`
          : `Trilio piedāvāja ${eur(f.trilioPriceCents)}`;
      return {
        body: [
          "Pajautāja un atradām.",
          `Pircējs ${f.month} pajautāja cenu precei ${f.product}. ${shopLine}, piegāde ${f.deliveryDays} darba dienās.`,
        ],
        cta: "Ja izdodas atrast zemāku cenu, atsūtām piedāvājumu; ja ne, paziņojam, kad cena veikalos samazinās.",
        card: {
          layout: "offer",
          chip: "Pajautāja un atradām",
          eyebrow: "Pajautāja un atradām",
          title: f.product,
          headline: f.product,
          hero: f.subcategoryId,
          ...(f.imageUrl ? { image: f.imageUrl } : {}),
          stat: { label: "Trilio piedāvājums", value: eur(f.trilioPriceCents) },
          ...(f.shopPriceCents !== null
            ? { stat2: { label: `Veikalā${f.shop ? ` ${f.shop}` : ""}`, value: eur(f.shopPriceCents) } }
            : {}),
          sub: `Piegāde ${f.deliveryDays} darba dienās · pircēja pieprasījums ${f.month}`,
          lines: [
            ...(f.shopPriceCents !== null
              ? [{ main: "Veikalā", side: eur(f.shopPriceCents), sub: f.shop ?? undefined }]
              : []),
            {
              main: "Trilio piedāvājums",
              side: eur(f.trilioPriceCents),
              sub: `Piegāde ${f.deliveryDays} darba dienās`,
            },
          ],
          note: `Pircēja pieprasījums ${f.month}`,
          subcategoryId: f.subcategoryId,
        },
        alt: `${f.product}: veikalā ${f.shopPriceCents !== null ? eur(f.shopPriceCents) : "—"}, Trilio piedāvājums ${eur(f.trilioPriceCents)}.`,
        prices: [f.trilioPriceCents, ...(f.shopPriceCents !== null ? [f.shopPriceCents] : [])],
        numbers: [f.deliveryDays],
        names: [f.product, ...(f.shop ? [f.shop] : [])],
        sub: f.subcategoryId,
      };
    }
    case "top_categories": {
      const [a] = f.categories;
      const slides: PostCard["slides"] = [
        {
          layout: "cover",
          chip: "Ko meklē šonedēļ",
          eyebrow: "Ko meklē šonedēļ",
          title: "Šonedēļ visbiežāk meklētais",
          headline: "Ko Latvija",
          headlineAccent: "meklēja šonedēļ.",
          sub: "Trilio lietotāju meklētākās kategorijas pēc kārtas.",
          rows: f.categories.map((c, i) => ({ n: `0${i + 1}`, label: c.label })),
          icons: f.categories.map((c) => c.id),
          lines: f.categories.map((c, i) => ({ main: `${i + 1}. ${c.label}` })),
        },
        ...f.categories.map((c, i) => ({
          layout: "rank" as const,
          ...(c.path ? { link: c.path } : {}),
          chip: `${i + 1}. vieta`,
          eyebrow: `${i + 1}. vieta šonedēļ`,
          title: c.label,
          headline: c.label,
          numeral: `0${i + 1}`,
          hero: c.id,
          ...(c.fromCents ? { stat: { label: "Cenas partneru veikalos no", value: eur(c.fromCents) } } : {}),
          sub: "Daži jautājumi, un trīs piemērotākie varianti.",
          subcategoryId: c.id,
          lines: [
            ...(c.fromCents ? [{ main: "Cenas partneru veikalos no", side: eur(c.fromCents) }] : []),
            { main: "Daži jautājumi, un trīs piemērotākie varianti" },
          ],
        })),
        {
          layout: "closing",
          chip: "Sākt izvēli",
          eyebrow: "trilio.lv",
          title: "Daži jautājumi, un trīs piemērotākie varianti",
          headline: "Daži jautājumi.",
          headlineAccent: "Trīs ieteikumi.",
          sub: "Pērc uzreiz vai pajautā zemāku cenu. Padoms bez maksas, bez konta.",
          icons: f.categories.map((c) => c.id),
          buttons: ["Sākt izvēli"],
          lines: [
            {
              main: "Pērc uzreiz vai pajautā zemāku cenu",
              sub: "Padoms bez maksas, bez konta",
              buttons: ["Sākt izvēli · trilio.lv"],
            },
          ],
          plainFooter: true,
        },
      ];
      return {
        body: [
          `Šonedēļ Trilio visvairāk meklētā kategorija: ${lower(a!.label)}.`,
          f.categories.map((c, i) => `${ORDER[i]} ${c.label}`).join("\n"),
        ],
        cta: "Katrai kategorijai trīs piemērotākie varianti pēc dažiem jautājumiem:",
        card: { ...slides[0]!, slides },
        alt: `Šonedēļ visbiežāk meklētās kategorijas: ${f.categories.map((c) => c.label).join(", ")}.`,
        prices: f.categories.flatMap((c) => (c.fromCents ? [c.fromCents] : [])),
        numbers: [4, 5],
        names: f.categories.flatMap((c) => [c.label, lower(c.label)]),
      };
    }
    case "top_products": {
      const card: PostCard = {
        layout: "cover",
        chip: "Nedēļas interesantākās",
        eyebrow: "Šonedēļ visvairāk interesēja",
        title: "Šonedēļ visvairāk interesēja",
        headline: "Trīs preces,",
        headlineAccent: "ko šonedēļ skatīja visvairāk.",
        sub: "Cenas šodien partneru veikalos.",
        rows: f.products.map((p, i) => ({ n: `0${i + 1}`, label: p.name, side: eur(p.priceCents) })),
        lines: f.products.map((p) => ({ main: p.name, side: eur(p.priceCents), sub: p.shop })),
        note: "Cenas šodien partneru veikalos",
      };
      const slides: PostCard["slides"] = [
        { ...card },
        ...f.products.map((p, i) => ({
          layout: "product" as const,
          ...(p.path ? { link: p.path } : {}),
          chip: `${i + 1}.`,
          eyebrow: `${i + 1}. vieta šonedēļ`,
          title: p.name,
          headline: p.name,
          numeral: `0${i + 1}`,
          hero: p.subcategoryId,
          ...(p.imageUrl ? { image: p.imageUrl } : {}),
          stat: { label: `Cena šodien · ${p.shop}`, value: eur(p.priceCents) },
          buttons: ["Iegūt lētāk", `Pirkt — ${p.shop}`],
          subcategoryId: p.subcategoryId,
          lines: [
            {
              main: p.shop,
              side: eur(p.priceCents),
              buttons: ["Iegūt lētāk", `Pirkt — ${p.shop}`],
            },
          ],
          note: "Cena šodien partneru veikalā",
        })),
      ];
      return {
        body: [
          `Šonedēļ Trilio lietotājus visvairāk interesēja ${f.products[0]!.name}.`,
          f.products.map((p, i) => `${ORDER[i]} ${p.name} — ${eur(p.priceCents)} (${p.shop})`).join("\n"),
        ],
        cta: "Var pirkt uzreiz veikalā vai pajautāt zemāku cenu:",
        card: { ...card, slides },
        alt: `Šonedēļ visvairāk interesēja: ${f.products.map((p) => `${p.name}, ${eur(p.priceCents)}`).join("; ")}.`,
        prices: f.products.map((p) => p.priceCents),
        numbers: [],
        names: f.products.flatMap((p) => [p.name, p.shop]),
      };
    }
    case "reel": {
      if (f.of) {
        const o = parts(f.of);
        return { ...o, body: [f.caption], cta: "", alt: o.alt };
      }
      return {
        body: [f.caption],
        cta: "",
        card: { chip: "Video", title: f.caption.split("\n")[0] ?? "", lines: [] },
        alt: f.caption.split("\n")[0] ?? "Trilio video",
        prices: [],
        numbers: [],
        names: [],
      };
    }
  }
}

/** The caption of a generated Reel: what the post about the same facts says, without the link line. */
export function reelCaption(of: Exclude<PostFacts, { kind: "reel" }>): string {
  const p = parts(of);
  return [...p.body, p.cta.replace(/:$/, ".")].filter(Boolean).join("\n\n");
}

/** The prices, numbers and names a caption about these facts may contain (for the owner's edits too). */
export function lintContext(f: PostFacts): PostLintContext {
  const p = parts(f);
  return { pricesCents: p.prices, numbers: p.numbers, names: p.names };
}

/** One post, both networks: Facebook carries the link, Instagram "saite profilā" and five tags. */
/**
 * One emoji per kind, at the start of the first line, and 👉 before the
 * Facebook link: at most two in a caption, each marking something (owner,
 * 31 Oct 2026). Never hype (🔥 ⏰ 🚨); the lint refuses those.
 */
export const KIND_EMOJI: Record<SocialKind, string> = {
  picks: "🏷️",
  price_drop: "📉",
  advice: "💡",
  offer: "📦",
  top_categories: "🔎",
  top_products: "🏷️",
  reel: "",
};

/** One question per post, without "tu": comments and saves carry the reach. */
export const KIND_QUESTION: Partial<Record<SocialKind, string>> = {
  picks: "Kuru no trim izvēlētos jūs? Rakstiet komentāros.",
  price_drop: "Kuras preces cenu pieskatīt nākamo? Rakstiet komentāros.",
  advice: "Kam jūs pievēršat uzmanību pirms pirkuma? Rakstiet komentāros.",
  top_categories: "Kuru kategoriju izvērtēt nākamo? Rakstiet komentāros.",
  top_products: "Kura no tām būtu jūsu izvēle? Rakstiet komentāros.",
};

export function composePost(
  f: PostFacts,
  opts: {
    postId: string;
    baseUrl: string;
    lead?: string;
    /** Which of the kind's designs to draw (designOf); the classic one when absent. */
    design?: Design;
    /** A photo of people for the "people" design. */
    photo?: PeoplePhoto | null;
  },
): ComposedPost {
  const p = parts(f, opts.lead);
  const fbLink = utmLink(opts.baseUrl, f.path, "facebook", f.kind, opts.postId);
  const emoji = KIND_EMOJI[f.kind];
  const lines = [...p.body];
  if (emoji && lines[0]) lines[0] = `${emoji} ${lines[0]}`;
  const question = KIND_QUESTION[f.kind];
  if (question) lines.push(question);
  const body = lines.join("\n\n");
  const pointed = f.kind === "reel" ? fbLink : `👉 ${fbLink}`;
  const captionFb = [body, p.cta ? `${p.cta}\n${pointed}` : pointed].join("\n\n");
  const captionIg = [
    body,
    // A line that leads to the link ends with a colon on Facebook; on Instagram the link is in the profile.
    p.cta ? `${p.cta.replace(/:$/, ".")} Saite profilā.` : "Saite profilā.",
    hashtags(p.sub).join(" "),
  ].join("\n\n");
  const ctx = { pricesCents: p.prices, numbers: p.numbers, names: p.names };
  const issues =
    f.kind === "reel"
      ? // A Reel the owner shot carries the owner's own words: only empty or too long stops it.
        f.of
        ? lintPost(f.caption, ctx)
        : ownerTextBlocks(f.caption)
      : [...new Set([...lintPost(captionFb, ctx), ...lintPost(captionIg, ctx), ...lintPost(p.alt, ctx)])];
  return {
    card: opts.design ? { ...restyle(p.card, f, opts.design, opts.photo), design: opts.design } : p.card,
    captionFb,
    captionIg,
    alt: p.alt,
    link: utmLink(opts.baseUrl, f.path, "instagram", f.kind, opts.postId),
    issues,
  };
}
