import type { PickLine } from "@/domain/social/captions";
import { formatEur } from "@/i18n/format";

// The Meta ads the agent makes itself (owner, 24 Nov 2026: the agent creates and publishes
// ads on its own). One kind of ad: a category's three picks at today's prices, drawn like the
// page's own posts, leading to that category's three picks on the site. Pure rules: which
// categories get an ad, what the ad says, and when an ad no longer tells the truth.

/** The agent's own campaign. Lower-case and plain, so the link's campaign tag carries it unchanged. */
export const AGENT_CAMPAIGN = "trilio-ai-epasti";
export const AGENT_ADSET = "latvija";
/** At most this many of the agent's ads run at once: each needs spend of its own to show a result. */
export const MAX_AGENT_ADS = 3;
/** One running ad per this much of Meta's daily share. */
export const CENTS_PER_AD = 100;
/** New ads made in one day, replacements included. */
export const MAX_NEW_ADS_PER_DAY = 3;

/** "fridge-20261124": the ad's name, and its tag in the link. */
export function adName(subcategoryId: string, day: string): string {
  return `${subcategoryId}-${day.replace(/-/g, "")}`;
}

/** Where the ad leads: the category's three picks, tagged so Trilio knows the campaign and the ad. */
export function adLink(baseUrl: string, subcategoryId: string, name: string): string {
  const q = new URLSearchParams({
    sub: subcategoryId,
    cena: "tipiska",
    utm_source: "meta",
    utm_medium: "paid_social",
    utm_campaign: AGENT_CAMPAIGN,
    utm_content: name,
  });
  return `${baseUrl.replace(/\/$/, "")}/rezultati?${q.toString()}`;
}

export type AdFacts = { category: string; picks: Pick<PickLine, "name" | "priceCents" | "shop">[] };

/**
 * The ad's words: what the three are and what they cost today, then what Trilio does. No
 * urgency, no "cheapest", no discount: the prices are the shops' prices as they stand.
 */
export function adText(f: AdFacts): { message: string; headline: string; description: string } {
  const lines = f.picks.map((p) => `• ${p.name}: ${formatEur(p.priceCents, "lv")}`);
  return {
    message: [
      `${f.category}: 3 piemēroti varianti šodienas cenās.`,
      lines.join("\n"),
      "Atbildi uz dažiem jautājumiem un redzi savus trīs. Vari arī pajautāt zemāku cenu.",
    ].join("\n\n"),
    headline: `${f.category}: 3 piemēroti varianti`.slice(0, 60),
    description: "Cenas partneru veikalos",
  };
}

/** An ad tells the truth while its three products and their prices are what the site shows now. */
export function factsChanged(shown: AdFacts, now: AdFacts): boolean {
  if (shown.picks.length !== now.picks.length) return true;
  return shown.picks.some(
    (p, i) => p.name !== now.picks[i]!.name || p.priceCents !== now.picks[i]!.priceCents,
  );
}

export type CategoryFunnel = { subcategoryId: string; resultsVisitors: number; sent: number; taps: number };

/**
 * The categories worth an ad, best first: where visitors of the results page leave e-mails (and,
 * before any e-mail, tap the request), smoothed so that three visitors and one e-mail do not
 * outrank a category seen by a hundred. Only categories that can show three picks today.
 */
export function categoriesToAdvertise(
  funnel: CategoryFunnel[],
  available: Set<string>,
  shareCents: number,
): string[] {
  const slots = Math.min(MAX_AGENT_ADS, Math.floor(shareCents / CENTS_PER_AD));
  if (slots <= 0) return [];
  const score = (f: CategoryFunnel) => (f.sent * 3 + f.taps + 0.5) / (f.resultsVisitors + 20);
  return funnel
    .filter((f) => available.has(f.subcategoryId))
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        b.resultsVisitors - a.resultsVisitors ||
        a.subcategoryId.localeCompare(b.subcategoryId),
    )
    .slice(0, slots)
    .map((f) => f.subcategoryId);
}
