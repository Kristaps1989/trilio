import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { product } from "@/domain/testing/builders";
import { defaultOption, optionCounts, priceStats, questionMatters, questionsThatMatter } from "./insight";

const fridge = getSubcategory("fridge")!;
const q = (id: string) => fridge.questions.find((x) => x.id === id)!;
const fr = (name: string, price: number, h: number, doors: string, volume: number) =>
  product({ name, price, attrs: { install: "free", doors, height_cm: h, volume_l: volume } });
const stock = [
  fr("A", 400, 185, "two", 300),
  fr("B", 500, 176, "two", 260),
  fr("C", 600, 201, "two", 380),
  fr("D", 150, 85, "one", 120),
];
const ctx = { products: stock, sub: fridge, answers: {} };

describe("flow insight (core rules 2, 4, 5)", () => {
  it("live counts per picture card; sizes nobody stocks show 0", () => {
    expect(optionCounts(ctx, q("install"))).toEqual({ free: 4, builtin: 0 });
    expect(optionCounts({ ...ctx, answers: { install: "free" } }, q("size"))).toEqual({
      h54: 0,
      h85: 1,
      h140: 0,
      h175: 1,
      h195: 2,
    });
  });

  it("pre-selects the answer most products fit", () => {
    expect(defaultOption(q("install"), optionCounts(ctx, q("install")))).toBe("free");
    const size = optionCounts({ ...ctx, answers: { install: "free" } }, q("size"));
    expect(defaultOption(q("size"), size)).toBe("h195");
  });

  it("skips a question the stock cannot answer (no hinge data on built-in fridges)", () => {
    const builtins = [product({ name: "X", attrs: { install: "builtin", height_cm: 177 } })];
    expect(
      questionMatters({ products: builtins, sub: fridge, answers: { install: "builtin" } }, q("hinge")),
    ).toBe(false);
  });

  it("keeps questions that change the result, skips the ones that do not", () => {
    expect(questionMatters({ ...ctx, answers: { install: "free" } }, q("size"))).toBe(true);
    expect(questionsThatMatter({ ...ctx, answers: { install: "free" } }).map((x) => x.id)).toEqual([
      "install",
      "size",
      "doors",
      "household",
    ]);
    // After the 85 cm size only one-door fridges remain: the doors question changes nothing.
    const small = { ...ctx, answers: { install: "free", size: "h85" } };
    expect(questionMatters(small, q("doors"))).toBe(false);
  });

  it("price stats: histogram of real prices and a middle-60 % default rounded to €10", () => {
    const s = priceStats({ ...ctx, answers: { install: "free", doors: "two" } })!;
    expect(s).toMatchObject({ count: 3, minCents: 40000, maxCents: 60000 });
    expect(s.buckets.reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.defaultMinCents % 1000).toBe(0);
    expect(s.defaultMaxCents % 1000).toBe(0);
  });

  it("an advice-only question (coffee cups) never shows its options as empty and is still asked", () => {
    const coffee = getSubcategory("coffee")!;
    const cups = coffee.questions.find((x) => x.id === "cups")!;
    const machines = [product({ name: "K", price: 300, attrs: { coffee_type: "auto", milk_system: true } })];
    const c = { products: machines, sub: coffee, answers: { type: "auto" } };
    expect(Object.values(optionCounts(c, cups))).toEqual([1, 1, 1]);
    expect(questionMatters(c, cups)).toBe(true);
  });
});
