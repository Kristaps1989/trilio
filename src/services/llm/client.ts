import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, count, eq, gte } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { llmCalls } from "@/db/schema";

// The only place the Claude API is called. Two purposes exist (see
// docs/LLM.md): routing a shopper's free text to a subcategory, and
// extracting structured attributes from partner feed text. Both go through
// `callStructured`, which enforces: structured output validated against a
// Zod schema, a per-purpose daily call cap, a timeout, and a usage log that
// never stores prompt or user text. Ranking and prices never go near this.

export type LlmPurpose = "free_text_routing" | "attribute_extraction";

export const DEFAULT_MODEL = "claude-opus-5-5";

export function llmModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

export function freeTextLlmEnabled(): boolean {
  return process.env.FEATURE_FREE_TEXT_LLM === "1" && !!process.env.ANTHROPIC_API_KEY;
}

export function extractionEnabled(): boolean {
  return process.env.FEATURE_LLM_EXTRACT === "1" && !!process.env.ANTHROPIC_API_KEY;
}

export function dailyCallCap(): number {
  const n = Number(process.env.LLM_DAILY_CALL_CAP ?? 2000);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

export type StructuredRequest<T> = {
  purpose: LlmPurpose;
  /** Stable text first; it is cached across calls. */
  system: string;
  /** Volatile per-call content. Untrusted text must be wrapped by the caller (see wrapUntrusted). */
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
};

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
  const model = llmModel();
  return async function callStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
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
      const response = await client.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 2048,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: req.effort ?? "low", format: zodOutputFormat(req.schema) },
      });
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
      const detail =
        err instanceof Anthropic.APIError ? `${err.status ?? "net"} ${err.name}` : (err as Error).name;
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
