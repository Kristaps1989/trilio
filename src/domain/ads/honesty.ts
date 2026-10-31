// Ad text follows the site's honesty rules (CLAUDE.md rule 4, docs/GROWTH_PLAN.md §8):
// no fake urgency or scarcity, no "cheapest" or "guaranteed" claims, no
// discount or number Trilio's data cannot show, and Google's length limits.

export const HEADLINE_MAX = 30;
export const DESCRIPTION_MAX = 90;

const BANNED: { re: RegExp; why: string }[] = [
  { re: /garant[eē]t/i, why: "guarantee claim" },
  { re: /l[eē]t[aā]k(ai|ā|ais|ie|o)s?\s+(latvij|visur|tirg)/i, why: "cheapest-anywhere claim" },
  { re: /\b(tikai|vien)\s+(šodien|sodien|rīt)\b/i, why: "fake urgency" },
  { re: /p[eē]d[eē]j(ā|a)\s+iesp[eē]ja/i, why: "fake urgency" },
  { re: /steidz|pasteidz|nenokav/i, why: "fake urgency" },
  { re: /\b(atlaid|akcij|izpārdo)/i, why: "discount claim Trilio does not make" },
  { re: /\b(bezmaksas\s+pieg[aā]de)/i, why: "shop's delivery terms are not Trilio's" },
  { re: /\b(nr\.?\s*1|numur(s|a)\s*1|#1|labākais\s+latvij)/i, why: "superlative claim" },
  { re: /%|procent/i, why: "percentage claim" },
  // Competitors' names are keywords only, never ad text (docs/GROWTH_PLAN.md §8).
  {
    re: /kur\s*pirkt\s*\.?\s*lv|kurpirkt|sal[iī]dzini\s*\.\s*lv|sal[iī]dzini\s+lv\b/i,
    why: "competitor name",
  },
  { re: /!{2,}|[A-ZĀČĒĢĪĶĻŅŠŪŽ]{6,}/, why: "shouting" },
];

/** Numbers an ad may contain: the ones the page will show (e.g. "3" picks, a price), passed in by the caller. */
export type LintContext = { allowedNumbers?: number[] };

/** The honesty rules without a length limit (shared with social posts, docs/SOCIAL_PLAN.md §2). */
export function honestyIssues(text: string, ctx: LintContext = {}): string[] {
  const issues: string[] = [];
  const t = text.trim();
  for (const b of BANNED) if (b.re.test(t)) issues.push(b.why);
  const allowed = new Set([...(ctx.allowedNumbers ?? []), 1, 2, 3]);
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(",", "."));
    if (!allowed.has(n)) issues.push(`number ${m[0]} is not in the data`);
  }
  return issues;
}

export function lintAdText(text: string, kind: "headline" | "description", ctx: LintContext = {}): string[] {
  const issues: string[] = [];
  const max = kind === "headline" ? HEADLINE_MAX : DESCRIPTION_MAX;
  const t = text.trim();
  if (!t) issues.push("empty");
  if ([...t].length > max) issues.push(`longer than ${max} characters`);
  return [...issues, ...honestyIssues(t, ctx)];
}

/** All issues of a responsive search ad, or [] when it may go out. */
export function lintAd(ad: { headlines: string[]; descriptions: string[] }, ctx: LintContext = {}): string[] {
  const out: string[] = [];
  if (ad.headlines.length < 3 || ad.headlines.length > 15) out.push("needs 3–15 headlines");
  if (ad.descriptions.length < 2 || ad.descriptions.length > 4) out.push("needs 2–4 descriptions");
  ad.headlines.forEach((h, i) =>
    lintAdText(h, "headline", ctx).forEach((x) => out.push(`headline ${i + 1}: ${x}`)),
  );
  ad.descriptions.forEach((d, i) =>
    lintAdText(d, "description", ctx).forEach((x) => out.push(`description ${i + 1}: ${x}`)),
  );
  if (new Set(ad.headlines.map((h) => h.toLowerCase())).size !== ad.headlines.length)
    out.push("duplicate headline");
  return out;
}
