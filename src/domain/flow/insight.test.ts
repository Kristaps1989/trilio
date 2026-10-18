import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { product } from "@/domain/testing/builders";
import { defaultOption, optionCounts, priceStats, questionMatters, questionsThatMatter } from "./insight";

const fridge = getSubcategory("fridge")!;
const q = (id: string) => fridge.questions.find((x) => x.id === id)!;
const stock = [
  product({ name: "A", price: 400, attrs: { form: "combi", height_cm: 185, volume_l: 300 } }),
  product({ name: "B", price: 500, attrs: { form: "combi", height_cm: 176, volume_l: 260 } }),
  product({ name: "C", price: 600, attrs: { form: "combi", height_cm: 201, volume_l: 380 } }),
  product({ name: "D", price: 150, attrs: { form: "compact", height_cm: 85, volume_l: 120 } }),
];
const ctx = { products: stock, sub: fridge, answers: {} };

describe("flow insight (core rules 2, 4, 5)", () => {
  it("live counts per picture card; unavailable forms show 0", () => {
    expect(optionCounts(ctx, q("form"))).toMatchObject({
      combi: 3,
      compact: 1,
      builtin: 0,
      sbs: 0,
      single: 0,
    });
  });

  it("pre-selects the answer most products fit", () => {
    expect(defaultOption(q("form"), optionCounts(ctx, q("form")))).toBe("combi");
  });

  it("skips a question the stock cannot answer (no hinge data on built-in fridges)", () => {
    const builtins = [product({ name: "X", attrs: { form: "builtin", height_cm: 177 } })];
    expect(
      questionMatters({ products: builtins, sub: fridge, answers: { form: "builtin" } }, q("hinge")),
    ).toBe(false);
  });

  it("keeps questions that change the result", () => {
    expect(questionMatters({ ...ctx, answers: { form: "combi" } }, q("height"))).toBe(true);
    expect(questionsThatMatter({ ...ctx, answers: { form: "combi" } }).map((x) => x.id)).toEqual([
      "form",
      "height",
      "household",
    ]);
  });

  it("price stats: histogram of real prices and a middle-60 % default rounded to €10", () => {
    const s = priceStats({ ...ctx, answers: { form: "combi" } })!;
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
