// Small pure helpers behind the admin pages (docs/ADMIN_AND_OFFERS_PLAN.md §4):
// date ranges, quartiles, answer counts, ratios and CSV.

export type RangeKey = "today" | "7" | "30" | "90";
export const RANGES: RangeKey[] = ["today", "7", "30", "90"];

export function parseRange(raw: string | undefined): RangeKey {
  return RANGES.includes(raw as RangeKey) ? (raw as RangeKey) : "30";
}

const DAY_MS = 24 * 3600 * 1000;

function rigaDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Riga",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Inclusive Riga days for a range, plus the previous period of the same length for comparison. */
export function rangeDays(
  key: RangeKey,
  now: Date,
): { from: string; to: string; prevFrom: string; prevTo: string; days: number } {
  const days = key === "today" ? 1 : Number(key);
  const to = rigaDay(now);
  const from = rigaDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  const prevTo = rigaDay(new Date(now.getTime() - days * DAY_MS));
  const prevFrom = rigaDay(new Date(now.getTime() - (2 * days - 1) * DAY_MS));
  return { from, to, prevFrom, prevTo, days };
}

/** Every Riga day from `from` to `to`, for charts with no gaps. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T12:00:00Z`);
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= end && out.length < 400; t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Change against the previous period in percent, or null without a base. */
export function change(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Quartiles by linear interpolation; null for an empty list. */
export function quartiles(values: number[]): { q1: number; median: number; q3: number } | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return Math.round(s[lo]! + (s[hi]! - s[lo]!) * (i - lo));
  };
  return { q1: at(0.25), median: at(0.5), q3: at(0.75) };
}

/** Most chosen answers per question across saved searches; multi-choice answers count each option. */
export function topAnswers(
  sessions: Record<string, unknown>[],
  limit = 3,
): { question: string; options: { option: string; count: number }[]; total: number }[] {
  const byQuestion = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const answers of sessions) {
    for (const [question, value] of Object.entries(answers)) {
      const values = Array.isArray(value) ? value : [value];
      const options = values.filter(
        (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
      );
      if (options.length === 0) continue;
      totals.set(question, (totals.get(question) ?? 0) + 1);
      const counts = byQuestion.get(question) ?? new Map<string, number>();
      for (const o of options) counts.set(String(o), (counts.get(String(o)) ?? 0) + 1);
      byQuestion.set(question, counts);
    }
  }
  return [...byQuestion.entries()]
    .map(([question, counts]) => ({
      question,
      total: totals.get(question) ?? 0,
      options: [...counts.entries()]
        .map(([option, count]) => ({ option, count }))
        .sort((a, b) => b.count - a.count || a.option.localeCompare(b.option))
        .slice(0, limit),
    }))
    .sort((a, b) => b.total - a.total || a.question.localeCompare(b.question));
}

/** Offers paid ÷ offers sent (§11.12), as a whole percent; null before anything was sent. */
export function paidRatio(paid: number, sent: number): number | null {
  return sent > 0 ? Math.round((paid / sent) * 100) : null;
}

/** RFC 4180 CSV with a header row; formula-looking cells are prefixed so spreadsheets do not run them. */
export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
