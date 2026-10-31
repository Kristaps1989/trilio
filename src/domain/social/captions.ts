import type { SocialKind } from "@/db/schema";
import { formatEur } from "@/i18n/format";
import { lintPost, type PostLintContext } from "./lint";

// The words of each post type (docs/SOCIAL_PLAN.md §3), from facts the job
// queried a moment before. Register (§6, owner D1): no "tu" and no "jūs" in
// captions; statements and infinitives. Every number comes from the facts,
// and `composePost` refuses a caption the lint does not pass.

export type PickLine = { name: string; priceCents: number; shop: string };

export type PostFacts =
  | { kind: "picks"; subcategoryId: string; category: string; picks: PickLine[]; path: string }
  | {
      kind: "price_drop";
      subcategoryId: string;
      productId: string;
      product: string;
      priceCents: number;
      lowCents: number;
      shop: string;
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
      path: string;
    }
  | { kind: "top_categories"; categories: { id: string; label: string }[]; path: string }
  | { kind: "top_products"; products: (PickLine & { id: string })[]; path: string }
  | { kind: "reel"; caption: string; videoUrl: string; path: string };

/** What the image shows (src/services/social/render.tsx draws it). */
export type PostCard = {
  chip: string;
  title: string;
  lines: { main: string; side?: string; sub?: string }[];
  note?: string;
  subcategoryId?: string;
};

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
      return {
        body: [
          head,
          f.picks.map((p, i) => `${ORDER[i]} ${p.name} — ${eur(p.priceCents)} (${p.shop})`).join("\n"),
          "Cenas šodien partneru veikalos.",
        ],
        cta: "Var pirkt uzreiz veikalā vai pieprasīt labāku cenu: tad pajautāsim izplatītājam.",
        card: {
          chip: "3 ieteikumi",
          title: f.category,
          lines: f.picks.map((p) => ({ main: p.name, side: eur(p.priceCents), sub: p.shop })),
          note: "Cenas šodien partneru veikalos",
          subcategoryId: f.subcategoryId,
        },
        alt: `Trīs ieteikumi: ${f.category}. ${f.picks.map((p) => `${p.name}, ${eur(p.priceCents)}`).join("; ")}.`,
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
          chip: "Cena samazinājās",
          title: f.product,
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
          chip: "Kā izvēlēties",
          title: f.category,
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
          chip: "Pieprasīts un atrasts",
          title: f.product,
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
    case "top_categories":
      return {
        body: [
          "Ko Trilio lietotāji šonedēļ meklēja visvairāk:",
          f.categories.map((c, i) => `${ORDER[i]} ${c.label}`).join("\n"),
        ],
        cta: "Katrai kategorijai trīs piemērotākie varianti pēc dažiem jautājumiem:",
        card: {
          chip: "Ko meklē šonedēļ",
          title: "Šonedēļ meklētākās kategorijas",
          lines: f.categories.map((c, i) => ({ main: `${i + 1}. ${c.label}` })),
        },
        alt: `Šonedēļ meklētākās kategorijas: ${f.categories.map((c) => c.label).join(", ")}.`,
        prices: [],
        numbers: [4, 5],
        names: f.categories.map((c) => c.label),
      };
    case "top_products":
      return {
        body: [
          "Šonedēļ Trilio lietotājus visvairāk interesēja:",
          f.products.map((p, i) => `${ORDER[i]} ${p.name} — ${eur(p.priceCents)} (${p.shop})`).join("\n"),
        ],
        cta: "Var pirkt uzreiz veikalā vai pieprasīt labāku cenu:",
        card: {
          chip: "Nedēļas interesantākās",
          title: "Šonedēļ visvairāk interesēja",
          lines: f.products.map((p) => ({ main: p.name, side: eur(p.priceCents), sub: p.shop })),
          note: "Cenas šodien partneru veikalos",
        },
        alt: `Šonedēļ visvairāk interesēja: ${f.products.map((p) => `${p.name}, ${eur(p.priceCents)}`).join("; ")}.`,
        prices: f.products.map((p) => p.priceCents),
        numbers: [],
        names: f.products.flatMap((p) => [p.name, p.shop]),
      };
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
export function composePost(
  f: PostFacts,
  opts: { postId: string; baseUrl: string; lead?: string },
): ComposedPost {
  const p = parts(f, opts.lead);
  const fbLink = utmLink(opts.baseUrl, f.path, "facebook", f.kind, opts.postId);
  const body = p.body.join("\n\n");
  const captionFb = [body, p.cta ? `${p.cta}\n${fbLink}` : fbLink].join("\n\n");
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
