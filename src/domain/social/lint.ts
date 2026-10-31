import { honestyIssues } from "@/domain/ads/honesty";

// A post's text must pass the same honesty rules as the ads, plus the social
// rules of docs/SOCIAL_PLAN.md §2 and §6. Prices are checked against the
// data the post was made from; links and hashtags are not text.

export type PostLintContext = {
  /** Every price the post may show, in cents. */
  pricesCents?: number[];
  /** Other numbers the data allows (delivery days, 30, ranks 1–5, numbers in our own advice text). */
  numbers?: number[];
  /** Names from the data (products, shops, categories): their model codes are not claims. */
  names?: string[];
};

export const CAPTION_MAX = 2200; // Instagram's limit; Facebook allows more.

const PRICE = /(\d{1,3}(?:[   ]\d{3})*(?:,\d{1,2})?)[   ]?€/g;
const LINK = /https?:\/\/\S+|\btrilio\.lv\S*/gi;
const TAG = /#[\p{L}\p{N}_]+/gu;

/** "1 079,50" → 107950. */
export function priceToCents(text: string): number {
  const [whole, frac = "0"] = text.replace(/[   ]/g, "").split(",");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}

const SOCIAL_RULES: { re: RegExp; why: string; unless?: RegExp }[] = [
  {
    re: /\b(tehnik\p{L}*|prec\p{L}*|ierīc\p{L}*)\b[^.!?\n]{0,40}\bbez maksas\b|\bbez maksas\b[^.!?\n]{0,40}\b(tehnik|prec|ierīc)/iu,
    why: "“bez maksas” next to goods: only the service is free",
  },
  {
    re: /\b(atsūtīsim|piedāvāsim|saņemsi|saņemsiet)\b/iu,
    unless: /\bja\b/iu,
    why: "an offer is promised without “ja”",
  },
  {
    re: /(?<![\p{L}])(tu|tev|tevi|tavs|tava|tavu|tavam|tavai|tavā|tavas|tavi|taviem|tavus)(?![\p{L}])/iu,
    why: "informal address: captions avoid the pronoun, or use “jūs”",
  },
  {
    // English function words that are not Latvian words: a line the model wrote in English.
    re: /(?<![\p{L}])(the|you|your|is|are|and|of|with|for|an|it|this|does|do|in)(?![\p{L}])/iu,
    why: "not Latvian",
  },
];

/** Emojis that sell urgency or hype; Trilio's honesty rules have no use for them. */
const HYPE = /[🔥⏰🚨💥‼❗⚡]/u;
const EMOJI = /\p{Extended_Pictographic}/gu;
const NOT_EMOJI = new Set(["©", "®", "™"]);
export const MAX_EMOJIS = 2;

export function lintPost(text: string, ctx: PostLintContext = {}): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (!t) return ["empty"];
  if ([...t].length > CAPTION_MAX) issues.push(`longer than ${CAPTION_MAX} characters`);
  const prices = new Set(ctx.pricesCents ?? []);
  for (const m of t.matchAll(PRICE)) {
    if (!prices.has(priceToCents(m[1]!))) issues.push(`price ${m[0]} is not in the data`);
  }
  let words = t.replace(LINK, " ").replace(TAG, " ").replace(PRICE, " ");
  for (const n of [...(ctx.names ?? [])].sort((a, b) => b.length - a.length))
    if (n) words = words.split(n).join(" ");
  issues.push(...honestyIssues(words, { allowedNumbers: ctx.numbers ?? [] }));
  for (const r of SOCIAL_RULES)
    if (r.re.test(words) && !(r.unless && r.unless.test(words))) issues.push(r.why);
  const emojis = [...words.matchAll(EMOJI)].filter((m) => !NOT_EMOJI.has(m[0]));
  if (emojis.length > MAX_EMOJIS) issues.push(`more than ${MAX_EMOJIS} emojis`);
  if (HYPE.test(words)) issues.push("hype emoji");
  return issues;
}
