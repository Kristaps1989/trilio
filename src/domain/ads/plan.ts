import type { Catalog } from "@/domain/questions/schema";
import { splitBudget } from "./budget";
import { lintAdText } from "./honesty";

// The first Search campaigns (docs/GROWTH_PLAN.md, Phase 1): one campaign per
// category group, one ad group per subcategory landing on the flow's first
// question, the seed keywords in phrase match, shared negatives, and one
// responsive search ad from templates that pass the honesty lint.

export type KeywordSeed = {
  negatives: string[];
  subcategories: Record<string, { short: string; keywords: string[] }>;
  /** Comparison sites' names as keywords (owner, 24 Oct 2026); never in ad text. */
  competitors?: { names: string[]; keywords: string[]; landingPath: string };
  /** Trilio's own name (owner, 12 Nov 2026), with negatives for the software company of the same name. */
  brand?: { keywords: string[]; negatives: string[]; landingPath: string };
};

export const COMPETITOR_GROUP = "competitors";
export const BRAND_GROUP = "brand";

/** Headlines every Trilio ad can use: what the service is, in the shopper's words (≤ 30 characters). */
const GENERIC_HEADLINES = [
  "3 piemērotākie varianti",
  "Atbildi uz dažiem jautājumiem",
  "Cenas partneru veikalos",
  "Bez konta un bez maksas",
  "Redzi, kāpēc tieši šie",
  "Secību nenosaka komisija",
  "Paziņosim, kad cena samazinās",
  "Trilio — izvēlies gudri",
];

/** Google's limits for one responsive search ad (docs: up to 15 headlines, 4 descriptions, 2 × 15-character paths). */
export const RSA_LIMITS = { headlines: 15, descriptions: 4, path: 15 } as const;

export type AdText = { headlines: string[]; descriptions: string[]; path1?: string; path2?: string };

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Keeps lines within Google's limits and the honesty rules, without duplicates (case-insensitive). */
function keep(lines: string[], kind: "headline" | "description", max: number, allowedNumbers: number[] = []) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    const key = line.toLowerCase();
    if (!line || seen.has(key) || lintAdText(line, kind, { allowedNumbers }).length) continue;
    seen.add(key);
    out.push(line);
    if (out.length === max) break;
  }
  return out;
}

/** The ad for searches of other comparison sites: says plainly what Trilio is. */
export function competitorAd(): AdText {
  return {
    headlines: keep(
      [
        "Trilio — izvēlies gudri",
        "Neatkarīgs padoms tehnikai",
        "3 piemērotākie varianti",
        "Atbildi uz dažiem jautājumiem",
        "Salīdzini cenas veikalos",
        "Cenu salīdzināšana tehnikai",
        "Ledusskapji un veļas mašīnas",
        "Putekļsūcēji, kafijas automāti",
        "Secību nenosaka komisija",
        "Bez konta un bez maksas",
        "Redzi, kāpēc tieši šie",
        "Paziņosim, kad cena samazinās",
      ],
      "headline",
      RSA_LIMITS.headlines,
    ),
    descriptions: keep(
      [
        "Trilio ir neatkarīgs palīgs tehnikas izvēlē: dažas atbildes un 3 piemērotākie varianti.",
        "Redzi, kāpēc ieteikts katrs variants, un salīdzini cenas partneru veikalos.",
        "Ledusskapji, veļas mašīnas, putekļsūcēji un cita tehnika: 3 varianti tavām vajadzībām.",
        "Bez konta un bez maksas. Saglabā variantu un saņem ziņu, kad tā cena samazinās.",
      ],
      "description",
      RSA_LIMITS.descriptions,
    ),
    path1: "izvelies",
  };
}

/** The ad for searches of Trilio's own name: what it is, where, and the two ways to buy. */
export function brandAd(): AdText {
  return {
    headlines: keep(
      [
        "Trilio — oficiālā vietne",
        "Trilio.lv: sadzīves tehnika",
        "Daži jautājumi, 3 ieteikumi",
        "Pērc uzreiz vai pajautā cenu",
        "Pajautā zemāku cenu",
        "Cenas partneru veikalos",
        "Ledusskapji un veļas mašīnas",
        "Bez konta un bez maksas",
        "Secību nenosaka komisija",
        "Redzi, kāpēc tieši šie",
      ],
      "headline",
      RSA_LIMITS.headlines,
    ),
    descriptions: keep(
      [
        "Trilio palīdz izvēlēties sadzīves tehniku: dažas atbildes un 3 piemērotākie varianti.",
        "Pērc veikalā uzreiz vai spied „Iegūt lētāk”: pajautāsim izplatītājam zemāku cenu.",
        "Salīdzinām cenas partneru veikalos Latvijā. Padoms bez maksas, konts nav vajadzīgs.",
        "Ledusskapji, veļas mašīnas, putekļsūcēji un cita tehnika: 3 varianti tavām vajadzībām.",
      ],
      "description",
      RSA_LIMITS.descriptions,
    ),
    path1: "trilio",
  };
}

export type PlannedAdGroup = {
  subcategoryId: string;
  name: string;
  landingPath: string;
  keywords: string[];
  ad: AdText;
};

export type PlannedCampaign = {
  name: string;
  groupId: string;
  budgetCents: number;
  adGroups: PlannedAdGroup[];
  negatives: string[];
};

/** "Veļas mašīnas" → "velas-masinas": a display-path segment of ASCII letters and hyphens. */
export function pathSlug(text: string): string {
  const map: Record<string, string> = {
    ā: "a",
    č: "c",
    ē: "e",
    ģ: "g",
    ī: "i",
    ķ: "k",
    ļ: "l",
    ņ: "n",
    š: "s",
    ū: "u",
    ž: "z",
  };
  return text
    .toLowerCase()
    .replace(/[āčēģīķļņšūž]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The display path Google shows under the headline: trilio.lv/izvelies/ledusskapji.
 * The second segment is the category's short name when it fits in 15 characters,
 * else its last word, else nothing.
 */
export function displayPaths(short?: string | null): { path1: string; path2?: string } {
  const path1 = "izvelies";
  if (!short) return { path1 };
  const whole = pathSlug(short);
  if (whole.length <= RSA_LIMITS.path) return { path1, path2: whole };
  const last = pathSlug(short.split(/\s+/).at(-1) ?? "");
  return last.length <= RSA_LIMITS.path && last.length >= 3 ? { path1, path2: last } : { path1 };
}

/**
 * The template ad for a subcategory (Google's "Ad strength" guidance: up to
 * 15 unique headlines with the ad group's keywords inside them, 4
 * descriptions, a display path). The category's name and its keywords come
 * first, then the budget steps the flow offers, then what Trilio is. Only
 * lines within Google's limits and the honesty rules are kept.
 */
export function templateAd(short: string, keywords: string[] = [], budgetStepsEur: number[] = []): AdText {
  const headlines = keep(
    [
      short,
      // Keywords as headlines, except the ones that would be a claim ("labākais ledusskapis").
      ...keywords.filter((k) => !/lab[aā]k|l[eē]t[aā]k/i.test(k)).map(capitalise),
      ...budgetStepsEur.slice(0, 2).map((eur) => `${short} līdz ${eur} €`),
      `${short} — salīdzini`,
      ...GENERIC_HEADLINES,
    ],
    "headline",
    RSA_LIMITS.headlines,
    budgetStepsEur,
  );
  const descriptions = keep(
    [
      "Atbildi uz dažiem jautājumiem un saņem 3 piemērotākos variantus ar cenām veikalos.",
      "Secību nenosaka veikalu komisija. Katram variantam redzi, kāpēc tas ieteikts.",
      `${short}: salīdzini cenas partneru veikalos un izvēlies pēc tā, kas tev svarīgs.`,
      "Bez konta un bez maksas. Saglabā variantu un saņem ziņu, kad tā cena samazinās.",
      // Only when the category's name makes the line above too long.
      "Salīdzini cenas partneru veikalos un izvēlies pēc tā, kas tev svarīgs.",
    ],
    "description",
    RSA_LIMITS.descriptions,
  );
  return { headlines, descriptions, ...displayPaths(short) };
}

export function buildCampaignPlan(
  catalog: Catalog,
  seed: KeywordSeed,
  dailyBudgetCents: number,
): PlannedCampaign[] {
  const campaigns: PlannedCampaign[] = [];
  for (const group of catalog.groups) {
    const adGroups: PlannedAdGroup[] = [];
    for (const sub of group.subcategories) {
      const s = seed.subcategories[sub.id];
      if (!s) continue;
      adGroups.push({
        subcategoryId: sub.id,
        name: sub.label,
        landingPath: `/izvelies/${group.id}/${sub.id}`,
        keywords: s.keywords,
        ad: templateAd(s.short, s.keywords, sub.budget_steps_eur ?? []),
      });
    }
    if (adGroups.length === 0) continue;
    campaigns.push({
      name: `Search · ${group.label}`,
      groupId: group.id,
      budgetCents: 0,
      adGroups,
      negatives: seed.negatives,
    });
  }
  if (seed.competitors?.keywords.length)
    campaigns.push({
      name: "Search · Konkurenti",
      groupId: COMPETITOR_GROUP,
      budgetCents: 0,
      adGroups: [
        {
          subcategoryId: COMPETITOR_GROUP,
          name: "Cenu salīdzināšana",
          landingPath: seed.competitors.landingPath,
          keywords: seed.competitors.keywords,
          ad: competitorAd(),
        },
      ],
      negatives: seed.negatives,
    });
  if (seed.brand?.keywords.length)
    campaigns.push({
      name: "Search · Trilio zīmols",
      groupId: BRAND_GROUP,
      budgetCents: 0,
      adGroups: [
        {
          subcategoryId: BRAND_GROUP,
          name: "Trilio",
          landingPath: seed.brand.landingPath,
          keywords: seed.brand.keywords,
          ad: brandAd(),
        },
      ],
      negatives: [...seed.negatives, ...seed.brand.negatives],
    });
  // Budget by keyword count, the best volume proxy before Keyword Planner data.
  const split = splitBudget(
    dailyBudgetCents,
    Object.fromEntries(campaigns.map((c) => [c.name, c.adGroups.reduce((a, g) => a + g.keywords.length, 0)])),
  );
  for (const c of campaigns) c.budgetCents = split[c.name] ?? 0;
  return campaigns;
}

/* ---------- extensions every Search campaign carries (owner, 14 Nov 2026) ---------- */

/** Google's limits: a sitelink's text is at most 25 characters, each description line 35. */
export const SITELINK_LIMITS = { text: 25, description: 35, callout: 25 } as const;

export type Sitelink = { text: string; description1: string; description2: string; path: string };

/**
 * Four sitelinks and four callouts for every Search campaign: Google shows them under the ad,
 * which makes it larger and lifts its click rate. Each sitelink leads to a different page.
 */
export function searchExtensions(): { sitelinks: Sitelink[]; callouts: string[] } {
  const sitelinks: Sitelink[] = [
    {
      text: "Ledusskapji",
      description1: "3 piemērotākie varianti",
      description2: "Cenas partneru veikalos",
      path: "/izvelies/cool",
    },
    {
      text: "Veļas mašīnas",
      description1: "Atbildi uz dažiem jautājumiem",
      description2: "Redzi, kāpēc tieši šie",
      path: "/izvelies/laundry",
    },
    {
      text: "Pārbaudi savu modeli",
      description1: "Ievadi modeli vai veikala saiti",
      description2: "Salīdzini cenu veikalos",
      path: "/modelis",
    },
    {
      text: "Kā mēs izvēlamies",
      description1: "Kā izvēlamies un ranžējam",
      description2: "Secību nenosaka komisija",
      path: "/par-trilio",
    },
  ];
  const callouts = [
    "Bez konta un bez maksas",
    "Pajautā zemāku cenu",
    "Secību nenosaka komisija",
    "Cenas partneru veikalos",
  ];
  return { sitelinks, callouts };
}
