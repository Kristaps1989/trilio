import { describe, expect, it } from "vitest";
import { adsToPause, leadRate, planMetaBudgets, splitChannels, type ChannelPerformance } from "./allocate";

// One daily budget for Google and Meta (owner, 24 Nov 2026): the split, Meta's budgets and
// the ads that had their chance.

const ch = (id: "google" | "meta", over: Partial<ChannelPerformance> = {}): ChannelPerformance => ({
  id,
  active: true,
  currentCents: 0,
  spendCents: 0,
  leads: 0,
  ...over,
});

describe("splitChannels", () => {
  it("gives everything to the only channel that runs, and nothing when none does", () => {
    expect(splitChannels(500, [ch("google"), ch("meta", { active: false })])).toEqual({
      google: 500,
      meta: 0,
    });
    expect(splitChannels(500, [ch("google", { active: false }), ch("meta")])).toEqual({
      google: 0,
      meta: 500,
    });
    expect(splitChannels(500, [ch("google", { active: false }), ch("meta", { active: false })])).toEqual({
      google: 0,
      meta: 0,
    });
    expect(splitChannels(0, [ch("google"), ch("meta")])).toEqual({ google: 0, meta: 0 });
  });

  it("starts even when neither has shown anything", () => {
    expect(splitChannels(500, [ch("google"), ch("meta")])).toEqual({ google: 250, meta: 250 });
  });

  it("leans to the channel with more e-mails per euro, but leaves the other 30 %", () => {
    const split = splitChannels(500, [
      ch("google", { spendCents: 6000, leads: 0 }),
      ch("meta", { spendCents: 6000, leads: 12 }),
    ]);
    expect(split).toEqual({ google: 150, meta: 350 });
    expect(split.google + split.meta).toBe(500);
  });

  it("moves at most a fifth of the total a day from today's split", () => {
    const perf = [
      ch("google", { currentCents: 400, spendCents: 6000, leads: 0 }),
      ch("meta", { currentCents: 100, spendCents: 6000, leads: 12 }),
    ];
    expect(splitChannels(500, perf)).toEqual({ google: 300, meta: 200 });
    // The next day it arrives.
    perf[0]!.currentCents = 300;
    perf[1]!.currentCents = 200;
    expect(splitChannels(500, perf)).toEqual({ google: 200, meta: 300 });
  });

  it("starts fresh when today's parts are not a split of this total (the owner changed it)", () => {
    expect(
      splitChannels(1000, [ch("google", { currentCents: 500 }), ch("meta", { currentCents: 0 })]),
    ).toEqual({ google: 500, meta: 500 });
  });

  it("keeps 1 € on each side of a small total", () => {
    expect(
      splitChannels(250, [
        ch("google", { spendCents: 9000, leads: 0 }),
        ch("meta", { spendCents: 9000, leads: 30 }),
      ]),
    ).toEqual({ google: 100, meta: 150 });
  });

  it("does not write a channel off for a few euro without an e-mail", () => {
    expect(leadRate({ spendCents: 200, leads: 0 })).toBeCloseTo(1 / 12);
    expect(leadRate({ spendCents: 0, leads: 0 })).toBeCloseTo(0.1);
  });
});

describe("planMetaBudgets", () => {
  const h = (id: string, dailyBudgetCents: number, spendCents = 0, leads = 0) => ({
    id,
    dailyBudgetCents,
    spendCents,
    leads,
  });
  it("gives one holder the whole share", () => {
    expect(planMetaBudgets(250, [h("a", 1500)])).toEqual({ budgets: { a: 250 }, pause: [] });
  });
  it("splits by e-mails per euro, at least 1 € each, exactly the share", () => {
    const plan = planMetaBudgets(500, [h("a", 1000, 3000, 6), h("b", 1000, 3000, 0)]);
    expect(plan.pause).toEqual([]);
    expect(plan.budgets.a! + plan.budgets.b!).toBe(500);
    expect(plan.budgets.a!).toBeGreaterThan(plan.budgets.b!);
    expect(plan.budgets.b!).toBeGreaterThanOrEqual(100);
  });
  it("pauses what the share cannot feed, keeping the best", () => {
    expect(planMetaBudgets(150, [h("a", 1000, 3000, 0), h("b", 500, 3000, 4), h("c", 500)])).toEqual({
      budgets: { b: 150 },
      pause: ["c", "a"],
    });
    expect(planMetaBudgets(50, [h("a", 1000)])).toEqual({ budgets: {}, pause: ["a"] });
    expect(planMetaBudgets(500, [])).toEqual({ budgets: {}, pause: [] });
  });
});

describe("adsToPause", () => {
  const ad = (id: string, adsetId: string, spendCents: number, leads = 0, active = true) => ({
    id,
    adsetId,
    active,
    spendCents,
    leads,
  });
  it("pauses an ad that spent 5 € without an e-mail, the one that spent most first", () => {
    expect(adsToPause([ad("a", "s1", 700), ad("b", "s1", 900), ad("c", "s1", 300)])).toEqual(["b"]);
  });
  it("never the last running ad of an ad set, and never one that brought an e-mail", () => {
    expect(adsToPause([ad("a", "s1", 2000)])).toEqual([]);
    expect(adsToPause([ad("a", "s1", 2000), ad("b", "s1", 100, 0, false)])).toEqual([]);
    expect(adsToPause([ad("a", "s1", 2000, 1), ad("b", "s1", 100)])).toEqual([]);
    expect(adsToPause([ad("a", "s1", 499), ad("b", "s1", 100)])).toEqual([]);
  });
  it("judges every ad set on its own", () => {
    expect(
      adsToPause([ad("a", "s1", 600), ad("b", "s1", 0), ad("c", "s2", 800), ad("d", "s2", 0, 2)]),
    ).toEqual(["a", "c"]);
  });
});
