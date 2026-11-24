import { honestyIssues } from "@/domain/ads/honesty";

// The SEO agent's rules (docs/GROWTH_PLAN.md, "One agent for every channel", part 2; owner,
// 24 Nov 2026: the agent applies SEO improvements on its own). It rewrites the title and the
// description a category page shows in Google when the page is seen but not clicked, using
// the words people really searched with, and takes the change back when it did not help.
// Pure: which pages, whether a text may go out, and the verdict three weeks later.

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;
/** A page is looked at only when Google showed it this often in 28 days. */
export const MIN_IMPRESSIONS = 30;
/** One change a page, then three weeks to see what it did. */
export const TRIAL_DAYS = 21;
/** After a change, kept or taken back, the page is left alone this long. */
export const REST_DAYS = 28;
/** Pages changed in one weekly run. */
export const MAX_CHANGES_PER_RUN = 3;

/** A category landing page's address: "/kategorija/fridge" or "/kategorija/fridge/lidz-800". */
export function landingOf(path: string): { sub: string; budgetEur: number | null } | null {
  const m = /^\/kategorija\/([a-z0-9_-]{2,40})(?:\/lidz-(\d{2,6}))?\/?$/.exec(path);
  return m ? { sub: m[1]!, budgetEur: m[2] ? Number(m[2]) : null } : null;
}

/**
 * The share of searchers who click a result at a position, roughly: what a page with an
 * ordinary title gets. A page well under it is seen and passed over.
 */
export function expectedCtr(position: number): number {
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.025;
  return 0.01;
}

export type PageSearch = {
  path: string;
  impressions: number;
  clicks: number;
  /** Average position, weighted by impressions. */
  position: number;
  /** What people searched, most seen first. */
  queries: { query: string; impressions: number; clicks: number; position: number }[];
};

/** Clicks the page would have had with an ordinary result, minus what it had. */
export function missedClicks(p: Pick<PageSearch, "impressions" | "clicks" | "position">): number {
  return p.impressions * expectedCtr(p.position) - p.clicks;
}

/**
 * The pages worth a new title, most missed clicks first: a category page Google shows on
 * its first two pages (position 3–20) at least 30 times in 28 days, clicked less than an
 * ordinary result there, and not changed lately.
 */
export function pickPages(
  pages: PageSearch[],
  resting: Set<string>,
  max = MAX_CHANGES_PER_RUN,
): PageSearch[] {
  return pages
    .filter(
      (p) =>
        landingOf(p.path) !== null &&
        !resting.has(p.path) &&
        p.impressions >= MIN_IMPRESSIONS &&
        p.position >= 3 &&
        p.position <= 20 &&
        missedClicks(p) >= 1,
    )
    .sort((a, b) => missedClicks(b) - missedClicks(a) || a.path.localeCompare(b.path))
    .slice(0, max);
}

/**
 * Why a title and description may not go out, or []: the lengths Google shows whole, the
 * category named in the title, no shouting, and the same honesty rules as every ad (no
 * "cheapest", guarantees, discounts or urgency, no number that is not a fact of the page).
 */
export function checkSeoText(
  text: { title: string; description: string },
  ctx: { category: string; allowedNumbers: number[] },
): string[] {
  const issues: string[] = [];
  const title = text.title.trim();
  const description = text.description.trim();
  if (!title) issues.push("empty title");
  if (!description) issues.push("empty description");
  if ([...title].length > TITLE_MAX) issues.push(`title longer than ${TITLE_MAX} characters`);
  if ([...description].length > DESCRIPTION_MAX)
    issues.push(`description longer than ${DESCRIPTION_MAX} characters`);
  if ([...description].length < 70 && description) issues.push("description shorter than 70 characters");
  // The category in any case form: its first letters are the same ("ledusskap…").
  const stem = ctx.category.toLowerCase().split(/\s+/)[0]!.slice(0, 6);
  if (stem && !title.toLowerCase().includes(stem)) issues.push("title does not name the category");
  if (/[A-ZĀČĒĢĪĶĻŅŠŪŽ]{5,}/.test(title)) issues.push("shouting");
  // The page shows the three that fit best, not the cheapest on the market: no such promise.
  if (/l[eē]t[aā]k(ais|ie|ā|ās|o|ajiem|ajām)(?![a-zāčēģīķļņšūž])/i.test(`${title} ${description}`))
    issues.push("cheapest claim");
  for (const t of [title, description])
    for (const i of honestyIssues(t, { allowedNumbers: ctx.allowedNumbers })) issues.push(i);
  return [...new Set(issues)];
}

export type SearchNumbers = { impressions: number; clicks: number; position: number };

const ctr = (n: SearchNumbers) => (n.impressions > 0 ? n.clicks / n.impressions : 0);

/**
 * Three weeks after a change: taken back when the page was shown enough to tell and people
 * clicked clearly less often than before (under 80 % of the old rate) without the page having
 * moved up; kept otherwise. "wait" while Google has not shown it enough to tell.
 */
export function trialVerdict(before: SearchNumbers, after: SearchNumbers): "keep" | "revert" | "wait" {
  if (after.impressions < MIN_IMPRESSIONS) return "wait";
  const worse = ctr(after) < ctr(before) * 0.8;
  const movedUp = after.position < before.position - 1;
  return worse && !movedUp ? "revert" : "keep";
}
