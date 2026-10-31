import type { SocialKind } from "@/db/schema";
import { formatEur } from "@/i18n/format";
import { lintPost, type PostLintContext } from "./lint";

// The words of each post type (docs/SOCIAL_PLAN.md §3), from facts the job
// queried a moment before. Register (§6, owner D1): no "tu" and no "jūs" in
// captions; statements and infinitives. Every number comes from the facts,
// and `composePost` refuses a caption the lint does not pass.

/** `imageUrl`: the product's photo from the shop's feed (an https URL on a partner host), when it has one. */
export type PickLine = { name: string; priceCents: number; shop: string; imageUrl?: string | null };

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
      /** `fromCents`: the lowest current price in the category, for its slide. */
      categories: { id: string; label: string; fromCents?: number | null }[];
      path: string;
    }
  | { kind: "top_products"; products: (PickLine & { id: string; subcategoryId?: string })[]; path: string }
  | { kind: "reel"; caption: string; videoUrl: string; path: string };

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
  | { kind: "picks"; picks: { name: string; shop: string; price: string }[] }
  | {
      kind: "card";
      name: string;
      shop: string;
      price: string;
      buttons: string[];
      note: string;
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
  layout?: "cover" | "rank" | "phone" | "statement" | "drop" | "product" | "offer" | "closing";
  /** Small capitals in lime above the headline. */
  eyebrow?: string;
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
};

/** Alt text for a slide from what it shows: the words people search for, nothing invented. */
export function slideAlt(c: Omit<PostCard, "slides">): string {
  if (c.alt) return c.alt;
  const lines = c.lines.map((l) => [l.main, l.side, l.sub, ...(l.chips ?? [])].filter(Boolean).join(", "));
  return [c.title, ...lines].filter(Boolean).join(". ").slice(0, 900);
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

export const TAGLINE = "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pieprasi labāku cenu.";

const eur = (cents: number) => formatEur(cents, "lv");

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
      const first = f.picks[0]!;
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
                { n: "03", label: "Pērc uzreiz vai pieprasi labāku cenu" },
              ],
              lines: [
                { main: "1. Daži jautājumi" },
                { main: "2. Trīs ieteikumi" },
                { main: "3. Pērc uzreiz vai pieprasi labāku cenu" },
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
                picks: f.picks.map((p) => ({ name: p.name, shop: p.shop, price: eur(p.priceCents) })),
              },
              lines: pickLines,
              note: "Piemērs bez atbildēm; cenas šodien partneru veikalos",
            },
            {
              layout: "phone",
              chip: "3. solis",
              eyebrow: "3. solis",
              title: "Pērc uzreiz vai pieprasi labāku cenu",
              headline: "Pērc uzreiz.",
              headlineAccent: "Vai pieprasi labāku cenu.",
              sub: "Ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena krīt.",
              phone: {
                kind: "card",
                name: first.name,
                shop: first.shop,
                price: eur(first.priceCents),
                buttons: [`Pirkt — ${first.shop}`, "Pieprasīt labāku cenu"],
                note: "Meklējam labāku cenu. Ja atradīsim, atsūtīsim piedāvājumu.",
                ...(first.imageUrl ? { image: first.imageUrl } : {}),
              },
              lines: [
                {
                  main: first.name,
                  side: eur(first.priceCents),
                  sub: first.shop,
                  buttons: [`Pirkt — ${first.shop}`, "Pieprasīt labāku cenu"],
                },
              ],
              note: "Ja varēsim piedāvāt lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena krīt",
            },
          ]
        : undefined;
      return {
        body: [
          head,
          f.picks.map((p, i) => `${ORDER[i]} ${p.name} — ${eur(p.priceCents)} (${p.shop})`).join("\n"),
          slides
            ? "Cenas šodien partneru veikalos. Kā tas notiek, redzams bildēs: daži jautājumi, trīs ieteikumi, tad pirkt uzreiz vai pieprasīt labāku cenu."
            : "Cenas šodien partneru veikalos.",
        ],
        cta: "Var pirkt uzreiz veikalā vai pieprasīt labāku cenu: tad pajautāsim izplatītājam.",
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
          sub: "Salīdzināts ar šī veikala zemāko cenu 30 dienās.",
          lines: [
            { main: "Tagad", side: eur(f.priceCents), sub: f.shop },
            { main: "Zemākā cena 30 dienās", side: eur(f.lowCents) },
          ],
          note: "Salīdzināts ar zemāko cenu 30 dienās (Omnibus)",
          subcategoryId: f.subcategoryId,
        },
        alt: `${f.product}: tagad ${eur(f.priceCents)} veikalā ${f.shop}, zemākā cena 30 dienās ${eur(f.lowCents)}.`,
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
          "Pieprasīts un atrasts.",
          `Pircējs ${f.month} pieprasīja labāku cenu precei ${f.product}. ${shopLine}, piegāde ${f.deliveryDays} darba dienās.`,
        ],
        cta: "Ja varam lētāk, piedāvājam; ja ne, paziņojam, kad cena veikalos krīt.",
        card: {
          layout: "offer",
          chip: "Pieprasīts un atrasts",
          eyebrow: "Pieprasīts un atrasts",
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
          sub: "Trilio lietotāju meklētākās kategorijas, pēc kārtas.",
          rows: f.categories.map((c, i) => ({ n: `0${i + 1}`, label: c.label })),
          icons: f.categories.map((c) => c.id),
          lines: f.categories.map((c, i) => ({ main: `${i + 1}. ${c.label}` })),
        },
        ...f.categories.map((c, i) => ({
          layout: "rank" as const,
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
          sub: "Pērc uzreiz vai pieprasi labāku cenu. Padoms bez maksas, bez konta.",
          icons: f.categories.map((c) => c.id),
          buttons: ["Sākt izvēli"],
          lines: [
            {
              main: "Pērc uzreiz vai pieprasi labāku cenu",
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
          chip: `${i + 1}.`,
          eyebrow: `${i + 1}. vieta šonedēļ`,
          title: p.name,
          headline: p.name,
          numeral: `0${i + 1}`,
          hero: p.subcategoryId,
          ...(p.imageUrl ? { image: p.imageUrl } : {}),
          stat: { label: `Cena šodien · ${p.shop}`, value: eur(p.priceCents) },
          buttons: [`Pirkt — ${p.shop}`, "Pieprasīt labāku cenu"],
          subcategoryId: p.subcategoryId,
          lines: [
            {
              main: p.shop,
              side: eur(p.priceCents),
              buttons: [`Pirkt — ${p.shop}`, "Pieprasīt labāku cenu"],
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
        cta: "Var pirkt uzreiz veikalā vai pieprasīt labāku cenu:",
        card: { ...card, slides },
        alt: `Šonedēļ visvairāk interesēja: ${f.products.map((p) => `${p.name}, ${eur(p.priceCents)}`).join("; ")}.`,
        prices: f.products.map((p) => p.priceCents),
        numbers: [],
        names: f.products.flatMap((p) => [p.name, p.shop]),
      };
    }
    case "reel":
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
  opts: { postId: string; baseUrl: string; lead?: string },
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
    p.cta ? `${p.cta} Saite profilā.` : "Saite profilā.",
    hashtags(p.sub).join(" "),
  ].join("\n\n");
  const ctx = { pricesCents: p.prices, numbers: p.numbers, names: p.names };
  const issues =
    f.kind === "reel"
      ? lintPost(f.caption, ctx)
      : [...new Set([...lintPost(captionFb, ctx), ...lintPost(captionIg, ctx), ...lintPost(p.alt, ctx)])];
  return {
    card: p.card,
    captionFb,
    captionIg,
    alt: p.alt,
    link: utmLink(opts.baseUrl, f.path, "instagram", f.kind, opts.postId),
    issues,
  };
}
