import { z } from "zod";
import { flowQuestions, sanitizeAnswers } from "@/domain/questions/engine";
import type { Answers, Question, Subcategory } from "@/domain/questions/schema";

// The guided flow keeps its state in the URL (`?a=`), so refresh, back and
// sharing all work and nothing depends on browser storage. This module is
// pure and runs on both server and client.
//
// Core rule 1 (docs/FILTERS_PLAN.md): the flow asks only the category's
// flow-stage questions and then the price range. Everything else (brands,
// urgency, refurbished, priorities) is a setting on the results page and
// travels in the same state.

export const TRAILING = { budget: "budget" } as const;
export type TrailingId = (typeof TRAILING)[keyof typeof TRAILING];

/** Price range in cents; a missing bound is "no limit". */
export const PriceRangeSchema = z
  .object({
    min: z.number().int().nonnegative().max(100_000_00).optional(),
    max: z.number().int().positive().max(100_000_00).optional(),
  })
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, "min above max");
export type PriceRange = z.infer<typeof PriceRangeSchema>;

/** Settings stored alongside category answers. */
export const TrailingSchema = z.object({
  /** Price range in cents, or "none" for "Budžets nav noteikts". A bare number is a maximum (old links, landing pages). */
  budget: z
    .union([z.number().int().positive().max(100_000_00), PriceRangeSchema, z.literal("none")])
    .optional(),
  refurbished: z.enum(["yes", "no"]).optional(),
  urgency: z.enum(["asap", "two_weeks", "no_rush"]).optional(),
  /** Preferred brands (results page). Soft preference unless `brandsOnly`. */
  brands: z.array(z.string().min(1).max(40)).max(12).optional(),
  brandsOnly: z.boolean().optional(),
  /** Show products whose fit-critical data is missing (the "Vēl N … rādīt" line). */
  showUnknown: z.boolean().optional(),
});
export type Trailing = z.infer<typeof TrailingSchema>;

export type FlowState = { answers: Answers; trailing: Trailing };

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  try {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeState(state: FlowState): string {
  const compact: Record<string, unknown> = { ...state.answers };
  for (const [k, v] of Object.entries(state.trailing)) if (v !== undefined) compact[`$${k}`] = v;
  return toBase64Url(JSON.stringify(compact));
}

/** Decodes and validates; unknown keys, invalid answers and hidden questions are dropped. Never throws. */
export function decodeState(sub: Subcategory, encoded: string | null | undefined): FlowState {
  const empty: FlowState = { answers: {}, trailing: {} };
  if (!encoded || encoded.length > 4096) return empty;
  const json = fromBase64Url(encoded);
  if (!json) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return empty;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return empty;
  const obj = raw as Record<string, unknown>;
  const trailing: Trailing = {};
  const answersRaw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith("$")) {
      answersRaw[k] = v;
      continue;
    }
    // Each setting is validated on its own, so one bad value never drops the others.
    const key = k.slice(1) as keyof Trailing;
    const shape = TrailingSchema.shape as Record<string, z.ZodTypeAny>;
    if (!(key in shape)) continue;
    const parsed = shape[key]!.safeParse(v);
    if (parsed.success && parsed.data !== undefined) (trailing as Record<string, unknown>)[key] = parsed.data;
  }
  return { answers: sanitizeAnswers(sub, answersRaw), trailing };
}

/**
 * Ordered screen ids for this state: the visible flow questions (minus those
 * `skip` says do not matter for the current stock, core rule 2), then price.
 */
export function sequence(sub: Subcategory, state: FlowState, skip?: (q: Question) => boolean): string[] {
  const ids = flowQuestions(sub, state.answers)
    .filter((q) => state.answers[q.id] !== undefined || !skip?.(q))
    .map((q) => q.id);
  ids.push(TRAILING.budget);
  return ids;
}

export function isAnswered(id: string, state: FlowState): boolean {
  if (id === TRAILING.budget) return state.trailing.budget !== undefined;
  return state.answers[id] !== undefined;
}

/** The first unanswered id, or null when the flow is complete. */
export function nextUnanswered(
  sub: Subcategory,
  state: FlowState,
  skip?: (q: Question) => boolean,
): string | null {
  for (const id of sequence(sub, state, skip)) if (!isAnswered(id, state)) return id;
  return null;
}

/** Price range in cents for ranking, or null when no budget is set. */
export function priceRange(state: FlowState): PriceRange | null {
  const b = state.trailing.budget;
  if (b === undefined || b === "none") return null;
  if (typeof b === "number") return { max: b };
  return b.min === undefined && b.max === undefined ? null : b;
}

/** The budget's upper limit in cents (rule 2 extras, radar), or null. */
export function budgetCents(state: FlowState): number | null {
  return priceRange(state)?.max ?? null;
}

export function withAnswer(state: FlowState, id: string, value: unknown): FlowState {
  if (id === TRAILING.budget) {
    // Option values travel as strings; budget values are cents.
    const coerced = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    const parsed = TrailingSchema.shape.budget.safeParse(coerced);
    return parsed.success ? { ...state, trailing: { ...state.trailing, budget: parsed.data } } : state;
  }
  return { ...state, answers: { ...state.answers, [id]: value as Answers[string] } };
}

export function withSetting<K extends keyof Trailing>(
  state: FlowState,
  key: K,
  value: Trailing[K],
): FlowState {
  const trailing = { ...state.trailing };
  if (value === undefined) delete trailing[key];
  else trailing[key] = value;
  return { ...state, trailing };
}

/** Removes an answer (a results-page chip cleared). */
export function withoutAnswer(state: FlowState, id: string): FlowState {
  const answers = { ...state.answers };
  delete answers[id];
  return { ...state, answers };
}
