import { z } from "zod";
import { allSubcategories, detectSubcategory, getSubcategory } from "@/domain/questions/catalog";
import { sanitizeAnswers } from "@/domain/questions/engine";
import type { Answers } from "@/domain/questions/schema";
import { ROUTER_SYSTEM } from "./catalog-prompt";
import { type StructuredCaller, wrapUntrusted } from "./client";

// Free-text → subcategory + pre-filled answers. Regex table first (free,
// deterministic); the model only when that finds nothing and the feature is
// on. Whatever the model returns is validated against the catalog before use.

export const MAX_FREE_TEXT_LENGTH = 300;

export type RouteResult = {
  subcategoryId: string | null;
  prefilled: Answers;
  outOfScope: boolean;
  /** "regex" | "llm" | "none" — how the decision was made; shown nowhere, logged for tuning. */
  source: "regex" | "llm" | "none";
  confidence: number | null;
};

export function routerOutputSchema() {
  const ids = allSubcategories().map((s) => s.id) as [string, ...string[]];
  return z.object({
    subcategory: z.enum(ids).nullable(),
    out_of_scope: z.boolean(),
    prefilled: z.array(
      z.object({
        question_id: z.string(),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
      }),
    ),
    confidence: z.number().min(0).max(100),
  });
}

export type RouterOutput = z.infer<ReturnType<typeof routerOutputSchema>>;

/** Turns a model answer into a validated route; invalid pre-fills are dropped silently. */
export function validateRouterOutput(out: RouterOutput): Omit<RouteResult, "source"> {
  if (out.out_of_scope || !out.subcategory) {
    return { subcategoryId: null, prefilled: {}, outOfScope: true, confidence: out.confidence };
  }
  const sub = getSubcategory(out.subcategory);
  if (!sub) return { subcategoryId: null, prefilled: {}, outOfScope: true, confidence: out.confidence };
  const raw: Record<string, unknown> = {};
  for (const p of out.prefilled) raw[p.question_id] = p.value;
  return {
    subcategoryId: sub.id,
    prefilled: sanitizeAnswers(sub, raw),
    outOfScope: false,
    confidence: out.confidence,
  };
}

export function normalizeFreeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_FREE_TEXT_LENGTH);
}

export async function routeFreeText(
  text: string,
  opts: { caller?: StructuredCaller; llmEnabled: boolean },
): Promise<RouteResult> {
  const none: RouteResult = {
    subcategoryId: null,
    prefilled: {},
    outOfScope: false,
    source: "none",
    confidence: null,
  };
  const clean = normalizeFreeText(text);
  if (!clean) return none;

  const byRegex = detectSubcategory(clean);
  const regexResult: RouteResult | null = byRegex
    ? { subcategoryId: byRegex, prefilled: {}, outOfScope: false, source: "regex", confidence: null }
    : null;

  // Without the model the regex table is the whole answer (no pre-fills).
  if (!opts.llmEnabled || !opts.caller) return regexResult ?? none;

  const result = await opts.caller({
    purpose: "free_text_routing",
    system: ROUTER_SYSTEM,
    user: `Classify this request:\n${wrapUntrusted("shopper_text", clean)}`,
    schema: routerOutputSchema(),
    maxTokens: 512,
    effort: "low",
  });
  if (!result.ok) return regexResult ?? none;

  const llm = { ...validateRouterOutput(result.value), source: "llm" as const };
  // A deterministic regex hit outranks the model on the subcategory; the model only adds pre-fills.
  if (regexResult && llm.subcategoryId !== regexResult.subcategoryId) return regexResult;
  return llm;
}
