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
};

export const COMPETITOR_GROUP = "competitors";

/** The ad for searches of other comparison sites: says plainly what Trilio is. */
export function competitorAd(): { headlines: string[]; descriptions: string[] } {
  return {
    headlines: [
      "Trilio — izvēlies gudri",
      "3 piemērotākie varianti",
      "Atbildi uz dažiem jautājumiem",
      "Secību nenosaka komisija",
      "Salīdzini cenas veikalos",
    ],
    descriptions: [
      "Trilio ir neatkarīgs palīgs tehnikas izvēlē: dažas atbildes un 3 piemērotākie varianti.",
      "Redzi, kāpēc ieteikts katrs variants, un salīdzini cenas partneru veikalos.",
    ],
  };
}

export type PlannedAdGroup = {
  subcategoryId: string;
  name: string;
  landingPath: string;
  keywords: string[];
  ad: { headlines: string[]; descriptions: string[] };
};

export type PlannedCampaign = {
  name: string;
  groupId: string;
  budgetCents: number;
  adGroups: PlannedAdGroup[];
  negatives: string[];
};

/** The template ad for a subcategory; only lines within Google's limits and the honesty rules are kept. */
export function templateAd(short: string): { headlines: string[]; descriptions: string[] } {
  const headlines = [
    short,
    `${short} — salīdzini`,
    "3 piemērotākie varianti",
    "Atbildi uz dažiem jautājumiem",
    "Cenas partneru veikalos",
    "Bez konta un bez maksas",
    "Redzi, kāpēc tieši šie",
  ].filter((h) => lintAdText(h, "headline").length === 0);
  const descriptions = [
    "Atbildi uz dažiem jautājumiem un saņem 3 piemērotākos variantus ar cenām veikalos.",
    "Secību nenosaka veikalu komisija. Katram variantam redzi, kāpēc tas ieteikts.",
  ];
  return { headlines, descriptions };
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
        ad: templateAd(s.short),
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
  // Budget by keyword count, the best volume proxy before Keyword Planner data.
  const split = splitBudget(
    dailyBudgetCents,
    Object.fromEntries(campaigns.map((c) => [c.name, c.adGroups.reduce((a, g) => a + g.keywords.length, 0)])),
  );
  for (const c of campaigns) c.budgetCents = split[c.name] ?? 0;
  return campaigns;
}
