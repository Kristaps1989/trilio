import { z } from "zod";
import { MAX_DAILY_SHIFT, MIN_CAMPAIGN_CENTS } from "./budget";
import { lintAd } from "./honesty";

// What the daily optimiser may change, and the limits written in code
// (docs/GROWTH_PLAN.md §5, Phase 2). Claude proposes; nothing reaches Google
// unless `checkProposal` passes it. Status, currency, geography, conversion
// settings and the total budget are not in the action set at all.

export const MAX_CHANGES_PER_DAY = 25;
export const CPC_MIN_CENTS = 5;
export const CPC_MAX_CENTS = 200;

const Keyword = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-zāčēģīķļņšūž0-9 .+-]+$/i, "Latvian words, digits and model codes only")
  .refine((t) => t.split(/\s+/).length <= 6, "at most 6 words");

export const ProposalSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_negative"),
    campaignId: z.string(),
    text: Keyword,
    match: z.enum(["phrase", "exact"]),
  }),
  z.object({ action: z.literal("pause_keyword"), keywordId: z.string() }),
  z.object({ action: z.literal("enable_keyword"), keywordId: z.string() }),
  z.object({
    action: z.literal("add_keyword"),
    adGroupId: z.string(),
    text: Keyword,
    match: z.enum(["phrase", "exact"]),
  }),
  z.object({ action: z.literal("set_cpc"), adGroupId: z.string(), cpcCapCents: z.number().int() }),
  z.object({
    action: z.literal("move_budget"),
    fromCampaignId: z.string(),
    toCampaignId: z.string(),
    cents: z.number().int(),
  }),
  z.object({
    action: z.literal("new_ad"),
    adGroupId: z.string(),
    headlines: z.array(z.string()),
    descriptions: z.array(z.string()),
  }),
  z.object({ action: z.literal("flag_landing"), adGroupId: z.string(), note: z.string().max(300) }),
]);

export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalAction = Proposal["action"];

export const ACTIONS: ProposalAction[] = [
  "add_negative",
  "pause_keyword",
  "enable_keyword",
  "add_keyword",
  "set_cpc",
  "move_budget",
  "new_ad",
  "flag_landing",
];

/** What the account looks like now, by our ids. */
export type AccountState = {
  paused: boolean;
  campaigns: Map<string, { budgetCents: number; status: string }>;
  adGroups: Map<string, { campaignId: string; cpcCapCents: number }>;
  keywords: Map<
    string,
    { adGroupId: string | null; campaignId: string; text: string; negative: boolean; status: string }
  >;
  /** Search terms and keywords with conversions in the last 28 days (lower-case). */
  convertingTerms: string[];
  /** Changes already applied today. */
  appliedToday: number;
  /** Numbers an ad may quote (picks shown, prices on the landing page). */
  allowedNumbers?: number[];
};

export type Verdict = { ok: true } | { ok: false; reason: string };

const containsPhrase = (term: string, phrase: string) =>
  ` ${term.toLowerCase()} `.includes(` ${phrase.toLowerCase().trim()} `);

export function checkProposal(raw: unknown, state: AccountState): Verdict & { proposal?: Proposal } {
  const parsed = ProposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: `invalid: ${parsed.error.issues[0]?.message ?? "shape"}` };
  const p = parsed.data;
  if (state.paused) return { ok: false, reason: "ads are paused by the owner", proposal: p };
  if (state.appliedToday >= MAX_CHANGES_PER_DAY)
    return { ok: false, reason: `daily limit of ${MAX_CHANGES_PER_DAY} changes reached`, proposal: p };
  const verdict = ((): Verdict => {
    switch (p.action) {
      case "add_negative": {
        if (!state.campaigns.has(p.campaignId)) return { ok: false, reason: "unknown campaign" };
        const hit = state.convertingTerms.find((t) => containsPhrase(t, p.text));
        if (hit) return { ok: false, reason: `would block a converting search: "${hit}"` };
        return { ok: true };
      }
      case "pause_keyword":
      case "enable_keyword": {
        const k = state.keywords.get(p.keywordId);
        if (!k || k.negative) return { ok: false, reason: "unknown keyword" };
        if (p.action === "pause_keyword" && state.convertingTerms.includes(k.text.toLowerCase()))
          return { ok: false, reason: "keyword has conversions in the last 28 days" };
        return { ok: true };
      }
      case "add_keyword": {
        if (!state.adGroups.has(p.adGroupId)) return { ok: false, reason: "unknown ad group" };
        const dup = [...state.keywords.values()].some(
          (k) => k.adGroupId === p.adGroupId && !k.negative && k.text.toLowerCase() === p.text.toLowerCase(),
        );
        return dup ? { ok: false, reason: "keyword exists" } : { ok: true };
      }
      case "set_cpc": {
        const g = state.adGroups.get(p.adGroupId);
        if (!g) return { ok: false, reason: "unknown ad group" };
        if (p.cpcCapCents < CPC_MIN_CENTS || p.cpcCapCents > CPC_MAX_CENTS)
          return { ok: false, reason: `CPC cap outside ${CPC_MIN_CENTS}–${CPC_MAX_CENTS} cents` };
        if (Math.abs(p.cpcCapCents - g.cpcCapCents) > Math.max(5, g.cpcCapCents * 0.5))
          return { ok: false, reason: "CPC cap changes by more than half" };
        return { ok: true };
      }
      case "move_budget": {
        const from = state.campaigns.get(p.fromCampaignId);
        const to = state.campaigns.get(p.toCampaignId);
        if (!from || !to || p.fromCampaignId === p.toCampaignId)
          return { ok: false, reason: "unknown campaigns" };
        if (p.cents <= 0) return { ok: false, reason: "nothing to move" };
        if (p.cents > Math.floor(from.budgetCents * MAX_DAILY_SHIFT))
          return { ok: false, reason: `moves more than ${MAX_DAILY_SHIFT * 100} % of a campaign budget` };
        if (from.budgetCents - p.cents < MIN_CAMPAIGN_CENTS)
          return { ok: false, reason: "leaves a campaign below 1 €" };
        return { ok: true };
      }
      case "new_ad": {
        if (!state.adGroups.has(p.adGroupId)) return { ok: false, reason: "unknown ad group" };
        const issues = lintAd(p, { allowedNumbers: state.allowedNumbers });
        return issues.length
          ? { ok: false, reason: `ad text: ${issues.slice(0, 3).join("; ")}` }
          : { ok: true };
      }
      case "flag_landing":
        return state.adGroups.has(p.adGroupId) ? { ok: true } : { ok: false, reason: "unknown ad group" };
    }
  })();
  return { ...verdict, proposal: p };
}

/** Whether an approved-or-auto proposal changes the Google account (a flag only informs). */
export const changesAccount = (p: Proposal) => p.action !== "flag_landing";
