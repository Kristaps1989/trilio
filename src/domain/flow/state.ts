import { z } from "zod";
import { sanitizeAnswers, visibleQuestions } from "@/domain/questions/engine";
import type { Answers, Subcategory } from "@/domain/questions/schema";

// The guided flow keeps its state in the URL (`?a=`), so refresh, back and
// sharing all work and nothing depends on browser storage. This module is
// pure and runs on both server and client.

export const TRAILING = { budget: "budget", refurbished: "refurbished", urgency: "urgency" } as const;
export type TrailingId = (typeof TRAILING)[keyof typeof TRAILING];

/** Answers to the three trailing questions, stored alongside category answers. */
export const TrailingSchema = z.object({
  /** Budget in cents, or "none" for "Budžets nav noteikts". */
  budget: z.union([z.number().int().positive().max(100_000_00), z.literal("none")]).optional(),
  refurbished: z.enum(["yes", "no"]).optional(),
  urgency: z.enum(["asap", "two_weeks", "no_rush"]).optional(),
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
  const trailingRaw: Record<string, unknown> = {};
  const answersRaw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$")) trailingRaw[k.slice(1)] = v;
    else answersRaw[k] = v;
  }
  const trailing = TrailingSchema.safeParse(trailingRaw);
  return { answers: sanitizeAnswers(sub, answersRaw), trailing: trailing.success ? trailing.data : {} };
}

/** Ordered question ids for this state: visible category questions, then the trailing ones. */
export function sequence(sub: Subcategory, state: FlowState, hasRefurbished: boolean): string[] {
  const ids = visibleQuestions(sub, state.answers).map((q) => q.id);
  ids.push(TRAILING.budget);
  if (hasRefurbished) ids.push(TRAILING.refurbished);
  ids.push(TRAILING.urgency);
  return ids;
}

export function isAnswered(id: string, state: FlowState): boolean {
  if (id === TRAILING.budget) return state.trailing.budget !== undefined;
  if (id === TRAILING.refurbished) return state.trailing.refurbished !== undefined;
  if (id === TRAILING.urgency) return state.trailing.urgency !== undefined;
  return state.answers[id] !== undefined;
}

/** The first unanswered id, or null when the flow is complete. */
export function nextUnanswered(sub: Subcategory, state: FlowState, hasRefurbished: boolean): string | null {
  for (const id of sequence(sub, state, hasRefurbished)) if (!isAnswered(id, state)) return id;
  return null;
}

/** Budget in cents for ranking: null when not set. */
export function budgetCents(state: FlowState): number | null {
  return typeof state.trailing.budget === "number" ? state.trailing.budget : null;
}

export function withAnswer(state: FlowState, id: string, value: unknown): FlowState {
  if (id === TRAILING.budget || id === TRAILING.refurbished || id === TRAILING.urgency) {
    // Option values travel as strings; the budget steps are cents.
    const coerced =
      id === TRAILING.budget && typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    const parsed = TrailingSchema.safeParse({ ...state.trailing, [id]: coerced });
    return parsed.success ? { ...state, trailing: parsed.data } : state;
  }
  return { ...state, answers: { ...state.answers, [id]: value as Answers[string] } };
}
