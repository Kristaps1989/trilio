// The one door to an ads platform (docs/GROWTH_PLAN.md §7). Everything Trilio
// changes in Google Ads is one of these operations, logged in ad_changes; the
// mock provider answers the same calls for tests and local runs.

export type Match = "exact" | "phrase" | "broad";

export type AdsChange =
  | { op: "create_campaign"; name: string; budgetCents: number; cpcCapCents: number }
  | { op: "create_ad_group"; campaign: string; name: string; cpcCapCents: number }
  | { op: "create_keyword"; adGroup: string; text: string; match: Match }
  | { op: "create_negative"; campaign: string; text: string; match: Match }
  | { op: "set_keyword_status"; keyword: string; status: "enabled" | "paused" }
  | { op: "create_ad"; adGroup: string; headlines: string[]; descriptions: string[]; finalUrl: string }
  | { op: "set_budget"; budget: string; cents: number }
  | { op: "set_cpc"; adGroup: string; cents: number }
  | { op: "set_campaign_status"; campaign: string; status: "enabled" | "paused" }
  | { op: "upload_image"; name: string; pngBase64: string }
  | {
      op: "create_pmax";
      name: string;
      budgetCents: number;
      finalUrl: string;
      businessName: string;
      headlines: string[];
      longHeadline: string;
      descriptions: string[];
      /** Asset resource names: logo (1:1), landscape (1.91:1) and square marketing images. */
      logo: string;
      landscape: string;
      square: string;
      searchThemes: string[];
    };

/** `id`: the main resource created; `budget`: a campaign's budget resource. */
export type ApplyResult = { ok: true; id?: string; budget?: string } | { ok: false; error: string };

export type StatRow = {
  /** "account": the whole Google Ads account, as the Google Ads overview shows it. */
  level: "account" | "campaign" | "ad_group" | "keyword";
  /** The platform's resource name. */
  resource: string;
  day: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
};

export type TermRow = {
  day: string;
  adGroup: string;
  term: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
};

/** The resources Trilio knows, so a mock can report on them. A real platform ignores this. */
export type Known = {
  campaigns: string[];
  adGroups: string[];
  keywords: { resource: string; adGroup: string; text: string }[];
};

export interface AdsProvider {
  readonly name: "google" | "mock";
  report(from: string, to: string, known: Known): Promise<{ stats: StatRow[]; terms: TermRow[] }>;
  apply(change: AdsChange): Promise<ApplyResult>;
}
