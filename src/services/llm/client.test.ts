import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb, type Db } from "@/db/client";
import { llmCalls } from "@/db/schema";
import {
  DEFAULT_MODEL,
  cacheHitRate,
  createCaller,
  dailyCallCap,
  estimateUsd,
  llmModel,
  usageToday,
} from "./client";

describe("defaults", () => {
  it("uses the cheap model and a 300-call cap unless configured", () => {
    const saved = { model: process.env.LLM_MODEL, cap: process.env.LLM_DAILY_CALL_CAP };
    delete process.env.LLM_MODEL;
    delete process.env.LLM_DAILY_CALL_CAP;
    expect(DEFAULT_MODEL).toBe("claude-haiku-5-5");
    expect(llmModel()).toBe("claude-haiku-5-5");
    expect(dailyCallCap()).toBe(300);
    process.env.LLM_MODEL = "claude-sonnet-5-5";
    process.env.LLM_DAILY_CALL_CAP = "abc";
    expect(llmModel()).toBe("claude-sonnet-5-5");
    expect(dailyCallCap()).toBe(300);
    if (saved.model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = saved.model;
    if (saved.cap === undefined) delete process.env.LLM_DAILY_CALL_CAP;
    else process.env.LLM_DAILY_CALL_CAP = saved.cap;
  });
});

describe("cacheHitRate", () => {
  it("is the share of prompt tokens read from the cache", () => {
    expect(cacheHitRate({ inputTokens: 100, cacheReadTokens: 4700, cacheWriteTokens: 200 })).toBe(0.94);
    expect(cacheHitRate({ inputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 4700 })).toBe(0);
    expect(cacheHitRate({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });
});

describe("estimateUsd", () => {
  const tokens = {
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
  };
  it("prices input, output and cache reads per model", () => {
    // Opus: 4 + 2 + 0.4 = 6.40; Haiku: 0.10 + 0.05 + 0.01 = 0.16.
    expect(estimateUsd({ model: "claude-opus-5-5", ...tokens })).toBe(6.4);
    expect(estimateUsd({ model: "claude-haiku-5-5", ...tokens })).toBe(0.16);
    expect(estimateUsd({ model: "claude-haiku-5-5", ...tokens, cacheWriteTokens: 800_000 })).toBe(0.26);
  });
  it("gives no estimate for an unknown model", () => {
    expect(estimateUsd({ model: "some-other-model", ...tokens })).toBeNull();
  });
});

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

run("usageToday", () => {
  let db: Db;
  const model = "usage-test-model";

  beforeAll(async () => {
    db = createDb(url!).db;
    const base = {
      purpose: "attribute_extraction",
      model,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: 1,
    };
    await db.insert(llmCalls).values([
      { ...base, inputTokens: 100, outputTokens: 10, ok: true, cacheReadTokens: 300 },
      { ...base, inputTokens: 50, outputTokens: 0, ok: false, error: "parse" },
      {
        ...base,
        inputTokens: 999,
        outputTokens: 999,
        ok: true,
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(llmCalls).where(eq(llmCalls.model, model));
    // createDb shares one pool per process: the last block in this file closes it.
  });

  it("sums today's calls per model, counting failures", async () => {
    const row = (await usageToday(db)).find((r) => r.model === model);
    expect(row).toMatchObject({
      purpose: "attribute_extraction",
      calls: 2,
      failed: 1,
      inputTokens: 150,
      outputTokens: 10,
      cacheReadTokens: 300,
      cacheHitRate: 0.67,
      estimatedUsd: null,
    });
  });
});

run("createCaller request shape (docs/PROMPT_CACHING_PLAN.md)", () => {
  let db: Db;
  let end: () => Promise<void>;
  const purpose = "free_text_routing";
  const sent: Record<string, unknown>[] = [];
  const fake = {
    messages: {
      parse: async (body: Record<string, unknown>) => {
        sent.push(body);
        return {
          stop_reason: "end_turn",
          parsed_output: { ok: true },
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 4700,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  } as unknown as Anthropic;

  beforeAll(() => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    process.env.ANTHROPIC_API_KEY ||= "test-key";
  });

  afterAll(async () => {
    await db.delete(llmCalls).where(eq(llmCalls.model, "cache-shape-test"));
    await end();
  });

  it("the frozen system prompt carries the only breakpoint; the request text comes after it", async () => {
    const saved = process.env.LLM_MODEL;
    process.env.LLM_MODEL = "cache-shape-test";
    const call = createCaller(db, fake);
    const schema = z.object({ ok: z.boolean() });
    for (const text of ["pirmais", "otrais"])
      await call({ purpose, system: "STABLE CATALOGUE", user: `Classify: ${text}`, schema });
    await call({ purpose, system: "SHORT", user: "x", schema, cache: false });
    process.env.LLM_CACHE_TTL = "1h";
    await call({ purpose, system: "STABLE CATALOGUE", user: "trešais", schema });
    delete process.env.LLM_CACHE_TTL;
    if (saved === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = saved;

    expect(JSON.stringify(sent[0]!.system)).toBe(JSON.stringify(sent[1]!.system));
    expect(sent[0]!.system).toEqual([
      { type: "text", text: "STABLE CATALOGUE", cache_control: { type: "ephemeral" } },
    ]);
    expect(JSON.stringify(sent[0]!.messages)).not.toContain("cache_control");
    expect(JSON.stringify(sent[1]!.messages)).toContain("otrais");
    expect(sent[2]!.system).toEqual([{ type: "text", text: "SHORT" }]);
    expect(sent[3]!.system).toEqual([
      { type: "text", text: "STABLE CATALOGUE", cache_control: { type: "ephemeral", ttl: "1h" } },
    ]);
    const [logged] = await db.select().from(llmCalls).where(eq(llmCalls.model, "cache-shape-test")).limit(1);
    expect(logged!.cacheReadTokens).toBe(4700);
  });
});
