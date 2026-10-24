import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { llmCalls } from "@/db/schema";

// The only place the Claude API is called. The purposes (see docs/LLM.md):
// routing a shopper's free text to a subcategory, extracting structured
// attributes from partner feed text, and the ads optimiser's daily review,
// search-term reading and ad copy (docs/GROWTH_PLAN.md). Both go through
// `callStructured`, which enforces: structured output validated against a
// Zod schema, a per-purpose daily call cap, a timeout, and a usage log that
// never stores prompt or user text. Ranking and prices never go near this.

export type LlmPurpose =
  | "free_text_routing"
  | "attribute_extraction"
  /** The daily ads optimiser and its weekly memo (docs/GROWTH_PLAN.md, Phase 2). */
  | "ads_optimiser"
  | "ads_terms"
  | "ads_copy";

/** Small, fast and cheap: reading spec tables and routing short text needs no more (LLM_MODEL overrides). */
export const DEFAULT_MODEL = "claude-haiku-5-5";

export function llmModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

export function freeTextLlmEnabled(): boolean {
  return process.env.FEATURE_FREE_TEXT_LLM === "1" && !!process.env.ANTHROPIC_API_KEY;
}

export function extractionEnabled(): boolean {
  return process.env.FEATURE_LLM_EXTRACT === "1" && !!process.env.ANTHROPIC_API_KEY;
}

export const DEFAULT_DAILY_CAP = 300;

export function dailyCallCap(): number {
  const n = Number(process.env.LLM_DAILY_CALL_CAP ?? DEFAULT_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

export type StructuredRequest<T> = {
  purpose: LlmPurpose;
  /** Overrides LLM_MODEL for this call (the ads optimiser reasons on Opus). */
  model?: string;
  /** Stable text first; it is cached across calls. */
  system: string;
  /** Volatile per-call content. Untrusted text must be wrapped by the caller (see wrapUntrusted). */
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Per-call limit when someone is waiting for the answer (default 30 s with 2 retries). */
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Mark the system prompt for prompt caching (default true). Off for prompts below the
   * model's minimum cacheable length (512 tokens on the 5.5 models): they never cache.
   */
  cache?: boolean;
};

/** Prompt-cache lifetime: "5m" (default, cheaper writes) or "1h" for traffic 5–60 min apart. */
export function cacheTtl(): "5m" | "1h" {
  return process.env.LLM_CACHE_TTL === "1h" ? "1h" : "5m";
}

export type StructuredResult<T> =
  | { ok: true; value: T; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; reason: "disabled" | "cap" | "refusal" | "parse" | "error"; detail?: string };

/** Anything that can answer a structured request; the real one is `createCaller`, tests inject fakes. */
export type StructuredCaller = <T>(req: StructuredRequest<T>) => Promise<StructuredResult<T>>;

/**
 * Wraps text the model must treat as data, not instructions. The tag name is
 * random per call so the text cannot close the wrapper itself.
 */
export function wrapUntrusted(label: string, text: string): string {
  const tag = `${label}_${Math.random().toString(36).slice(2, 8)}`;
  const safe = text.replace(/[<>]/g, " ");
  return `<${tag}>\n${safe}\n</${tag}>`;
}

async function underDailyCap(db: Db, purpose: LlmPurpose): Promise<boolean> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: count() })
    .from(llmCalls)
    .where(and(eq(llmCalls.purpose, purpose), gte(llmCalls.createdAt, start)));
  return (row?.n ?? 0) < dailyCallCap();
}

export function createCaller(
  db: Db,
  client = new Anthropic({ timeout: 30_000, maxRetries: 2 }),
): StructuredCaller {
  return async function callStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = req.model ?? llmModel();
    if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "disabled" };
    if (!(await underDailyCap(db, req.purpose))) return { ok: false, reason: "cap" };

    const started = Date.now();
    const log = {
      purpose: req.purpose,
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: 0,
      ok: false,
      error: null as string | null,
    };
    try {
      const response = await client.messages.parse(
        {
          model,
          max_tokens: req.maxTokens ?? 2048,
          // One explicit breakpoint at the end of the frozen system prompt; the per-request
          // text goes in the user message after it (docs/PROMPT_CACHING_PLAN.md).
          system: [
            req.cache === false
              ? { type: "text", text: req.system }
              : {
                  type: "text",
                  text: req.system,
                  cache_control:
                    cacheTtl() === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" },
                },
          ],
          messages: [{ role: "user", content: req.user }],
          output_config: { effort: req.effort ?? "low", format: zodOutputFormat(req.schema) },
        },
        {
          ...(req.timeoutMs ? { timeout: req.timeoutMs } : {}),
          ...(req.maxRetries !== undefined ? { maxRetries: req.maxRetries } : {}),
        },
      );
      log.inputTokens = response.usage.input_tokens;
      log.outputTokens = response.usage.output_tokens;
      log.cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;
      log.cacheWriteTokens = response.usage.cache_creation_input_tokens ?? 0;
      if (response.stop_reason === "refusal") {
        log.error = "refusal";
        return { ok: false, reason: "refusal" };
      }
      if (!response.parsed_output) {
        log.error = "parse";
        return { ok: false, reason: "parse" };
      }
      log.ok = true;
      return {
        ok: true,
        value: response.parsed_output,
        usage: { inputTokens: log.inputTokens, outputTokens: log.outputTokens },
      };
    } catch (err) {
      // The API's own message (e.g. "model not found", "credit balance too low") says what to fix;
      // it never contains the prompt. Only the admin sees it.
      const detail = (
        err instanceof Anthropic.APIError
          ? `${err.status ?? "net"} ${err.name}: ${err.message}`
          : `${(err as Error).name}: ${(err as Error).message}`
      ).slice(0, 300);
      log.error = detail;
      return { ok: false, reason: "error", detail };
    } finally {
      log.durationMs = Date.now() - started;
      await db
        .insert(llmCalls)
        .values(log)
        .catch(() => undefined);
    }
  };
}

/**
 * USD per million tokens (input, output), from Anthropic's price list of
 * October 2026 for prompts up to 100K tokens. Cache reads cost 0.1x input and
 * 5-minute cache writes 1.25x. Only for the estimate in the log line; the
 * Claude Console shows the billed amount.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export type UsageRow = {
  purpose: string;
  model: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Estimated USD for one model's tokens; null for a model without a known price. */
export function estimateUsd(u: Omit<UsageRow, "calls" | "failed" | "purpose">): number | null {
  const price = PRICES[u.model];
  if (!price) return null;
  const usd =
    (u.inputTokens * price.input +
      u.cacheReadTokens * price.input * 0.1 +
      u.cacheWriteTokens * price.input * 1.25 +
      u.outputTokens * price.output) /
    1_000_000;
  return Math.round(usd * 100) / 100;
}

/** Share of prompt tokens served from the cache (0–1); null with no prompt tokens. */
export function cacheHitRate(
  u: Pick<UsageRow, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">,
): number | null {
  const total = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  return total > 0 ? Math.round((u.cacheReadTokens / total) * 100) / 100 : null;
}

/** Today's (UTC) Claude API usage per purpose and model, for the log line after each job run. */
export async function usageToday(db: Db, now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return usageSince(db, start);
}

/** Calls, tokens, cache hit rate and estimated cost per purpose and model since `start` (the admin's month view). */
export async function usageSince(db: Db, start: Date) {
  const rows: UsageRow[] = await db
    .select({
      purpose: llmCalls.purpose,
      model: llmCalls.model,
      calls: count(),
      failed: sql<number>`count(*) filter (where not ${llmCalls.ok})`.mapWith(Number),
      inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`.mapWith(Number),
      cacheReadTokens: sql<number>`coalesce(sum(${llmCalls.cacheReadTokens}), 0)`.mapWith(Number),
      cacheWriteTokens: sql<number>`coalesce(sum(${llmCalls.cacheWriteTokens}), 0)`.mapWith(Number),
    })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, start))
    .groupBy(llmCalls.purpose, llmCalls.model);
  return rows.map((r) => ({ ...r, cacheHitRate: cacheHitRate(r), estimatedUsd: estimateUsd(r) }));
}
