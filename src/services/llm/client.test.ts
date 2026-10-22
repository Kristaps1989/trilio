import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { llmCalls } from "@/db/schema";
import { DEFAULT_MODEL, dailyCallCap, estimateUsd, llmModel, usageToday } from "./client";

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
  let end: () => Promise<void>;
  const model = "usage-test-model";

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    const base = {
      purpose: "attribute_extraction",
      model,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: 1,
    };
    await db.insert(llmCalls).values([
      { ...base, inputTokens: 100, outputTokens: 10, ok: true },
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
    await end();
  });

  it("sums today's calls per model, counting failures", async () => {
    const row = (await usageToday(db)).find((r) => r.model === model);
    expect(row).toMatchObject({
      calls: 2,
      failed: 1,
      inputTokens: 150,
      outputTokens: 10,
      estimatedUsd: null,
    });
  });
});
