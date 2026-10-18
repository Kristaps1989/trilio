import { isRangeAnswer, visibleQuestions } from "@/domain/questions/engine";
import type { Answers, RangeAnswer } from "@/domain/questions/schema";
import type { PriceBounds } from "./filters";
import { countMatches, type RankInput } from "./rank";

// "Never a dead end" (docs/FILTERS_PLAN.md §3.5, §4.2): when fewer than three
// products fit, find the smallest changes that add options and say exactly
// how many each adds. Every number comes from countMatches, the same rules
// the results use, so a suggestion is always true when tapped.

export type Relaxation =
  | { kind: "price_max"; maxCents: number; gain: number }
  | { kind: "price_min"; gain: number }
  | { kind: "range_max"; questionId: string; max: number | null; unit: string; gain: number }
  | { kind: "brands"; gain: number }
  | { kind: "show_unknown"; gain: number };

type Input = Omit<RankInput, "includeRefurbished">;

function roundUpTo(cents: number, stepCents: number): number {
  return Math.ceil(Math.round(cents) / stepCents) * stepCents;
}

/** Up to `limit` changes that add products, smallest change first among equal gains. */
export function relaxations(input: Input, limit = 3): Relaxation[] {
  const base = countMatches(input);
  const out: Relaxation[] = [];
  const range: PriceBounds = typeof input.budget === "number" ? { max: input.budget } : input.budget;

  if (range?.max !== undefined) {
    // Raise the upper limit in steps; stop at the first step that adds something.
    for (const factor of [1.1, 1.25, 1.5]) {
      const maxCents = roundUpTo(range.max * factor, range.max >= 20_000 ? 1_000 : 500);
      const gain = countMatches({ ...input, budget: { ...range, max: maxCents } }) - base;
      if (gain > 0) {
        out.push({ kind: "price_max", maxCents, gain });
        break;
      }
    }
  }
  if (range?.min !== undefined) {
    const gain = countMatches({ ...input, budget: { max: range.max } }) - base;
    if (gain > 0) out.push({ kind: "price_min", gain });
  }

  for (const q of visibleQuestions(input.sub, input.answers)) {
    const a = input.answers[q.id];
    if (q.type !== "range" || !isRangeAnswer(a) || a.max === undefined) continue;
    const r = q.range!;
    const steps = [5, 10].map((d) => Math.min(r.max, a.max! + d * r.step));
    let found = false;
    for (const max of steps) {
      const answers: Answers = { ...input.answers, [q.id]: { ...a, max } as RangeAnswer };
      const gain = countMatches({ ...input, answers }) - base;
      if (gain > 0) {
        out.push({ kind: "range_max", questionId: q.id, max, unit: r.unit, gain });
        found = true;
        break;
      }
    }
    if (!found) {
      const answers: Answers = { ...input.answers, [q.id]: {} };
      const gain = countMatches({ ...input, answers }) - base;
      if (gain > 0) out.push({ kind: "range_max", questionId: q.id, max: null, unit: r.unit, gain });
    }
  }

  if (input.brandsOnly && input.brands?.length) {
    const gain = countMatches({ ...input, brandsOnly: false }) - base;
    if (gain > 0) out.push({ kind: "brands", gain });
  }

  if (!input.showUnknown) {
    const gain = countMatches({ ...input, showUnknown: true }) - base;
    if (gain > 0) out.push({ kind: "show_unknown", gain });
  }

  // Data-quality fallback last: prefer changes the user controls.
  const order = (r: Relaxation) => (r.kind === "show_unknown" ? 1 : 0);
  return out.sort((x, y) => order(x) - order(y) || y.gain - x.gain).slice(0, limit);
}
