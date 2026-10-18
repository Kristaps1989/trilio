import { describe, expect, it } from "vitest";
import { limitsFridge as fridge } from "@/domain/testing/fixtures";
import {
  budgetCents,
  decodeState,
  encodeState,
  nextUnanswered,
  priceRange,
  sequence,
  withAnswer,
  withSetting,
  withoutAnswer,
  type FlowState,
} from "./state";

const empty: FlowState = { answers: {}, trailing: {} };

describe("flow state in the URL", () => {
  it("round-trips answers, ranges and results-page settings", () => {
    const s: FlowState = {
      answers: { install: "free", height: { max: 186 }, household: "4", priorities: ["quiet"] },
      trailing: {
        budget: { min: 35000, max: 50000 },
        urgency: "asap",
        brands: ["Bosch", "Samsung"],
        brandsOnly: true,
      },
    };
    expect(decodeState(fridge, encodeState(s))).toEqual(s);
  });

  it("drops invalid settings one by one and never throws", () => {
    const raw = encodeState({ answers: { install: "free" }, trailing: {} }).slice(0, -2) + "!!";
    expect(() => decodeState(fridge, raw)).not.toThrow();
    const bad = btoa(
      JSON.stringify({ install: "free", $budget: { min: 5, max: 1 }, $urgency: "now", $brands: ["Bosch"] }),
    );
    expect(decodeState(fridge, bad)).toEqual({
      answers: { install: "free" },
      trailing: { brands: ["Bosch"] },
    });
  });

  it("the flow is the visible flow questions, then price (no urgency, no refurbished)", () => {
    expect(sequence(fridge, withAnswer(empty, "install", "free"))).toEqual([
      "install",
      "height",
      "household",
      "budget",
    ]);
  });

  it("skips questions the stock makes irrelevant, unless already answered", () => {
    const skipHeight = (q: { id: string }) => q.id === "height";
    const s = withAnswer(empty, "install", "free");
    expect(sequence(fridge, s, skipHeight)).toEqual(["install", "household", "budget"]);
    expect(sequence(fridge, withAnswer(s, "height", { max: 186 }), skipHeight)).toContain("height");
    expect(nextUnanswered(fridge, s, skipHeight)).toBe("household");
  });

  it("price range: object, legacy upper limit (landing pages) and none", () => {
    expect(priceRange(withAnswer(empty, "budget", { min: 31000, max: 52300 }))).toEqual({
      min: 31000,
      max: 52300,
    });
    expect(priceRange(withAnswer(empty, "budget", "50000"))).toEqual({ max: 50000 });
    expect(priceRange(withAnswer(empty, "budget", "none"))).toBeNull();
    expect(budgetCents(withAnswer(empty, "budget", { min: 100, max: 900 }))).toBe(900);
  });

  it("settings and cleared answers", () => {
    const s = withSetting(withAnswer(empty, "household", "2"), "showUnknown", true);
    expect(s.trailing.showUnknown).toBe(true);
    expect(withSetting(s, "showUnknown", undefined).trailing).toEqual({});
    expect(withoutAnswer(s, "household").answers).toEqual({});
  });
});
