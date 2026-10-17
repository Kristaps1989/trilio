import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { budgetCents, decodeState, encodeState, nextUnanswered, sequence, withAnswer } from "./state";

const fridge = getSubcategory("fridge")!;

describe("flow state codec", () => {
  it("round-trips answers and trailing values through a URL-safe string", () => {
    const state = {
      answers: { type: "builtin", niche: 178, priorities: ["quiet", "energy"] },
      trailing: { budget: 80000, refurbished: "yes" as const },
    };
    const encoded = encodeState(state);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeState(fridge, encoded)).toEqual(state);
  });

  it("drops invalid answers, hidden questions, unknown keys and bad trailing values", () => {
    const encoded = encodeState({
      answers: { type: "builtin", size: "tall", household: "99", evil: "x" } as never,
      trailing: { budget: -5 as never, urgency: "asap" },
    });
    const s = decodeState(fridge, encoded);
    expect(s.answers).toEqual({ type: "builtin" });
    expect(s.trailing).toEqual({});
  });

  it("never throws on garbage", () => {
    expect(decodeState(fridge, "not base64 at all!!")).toEqual({ answers: {}, trailing: {} });
    expect(decodeState(fridge, "W10")).toEqual({ answers: {}, trailing: {} }); // "[]"
    expect(decodeState(fridge, null)).toEqual({ answers: {}, trailing: {} });
    expect(decodeState(fridge, "x".repeat(5000))).toEqual({ answers: {}, trailing: {} });
  });
});

describe("sequence and progress", () => {
  it("lists visible questions then budget, refurbished (if stock) and urgency", () => {
    const s = { answers: { type: "builtin" }, trailing: {} };
    expect(sequence(fridge, s, true)).toEqual([
      "type",
      "niche",
      "freezer",
      "household",
      "priorities",
      "budget",
      "refurbished",
      "urgency",
    ]);
    expect(sequence(fridge, s, false)).toEqual([
      "type",
      "niche",
      "freezer",
      "household",
      "priorities",
      "budget",
      "urgency",
    ]);
  });

  it("walks to the next unanswered id and completes", () => {
    let s = { answers: {}, trailing: {} } as ReturnType<typeof decodeState>;
    expect(nextUnanswered(fridge, s, false)).toBe("type");
    s = withAnswer(s, "type", "free");
    s = withAnswer(s, "size", "wide");
    s = withAnswer(s, "household", "4");
    s = withAnswer(s, "priorities", ["quiet"]);
    expect(nextUnanswered(fridge, s, false)).toBe("budget");
    s = withAnswer(s, "budget", "none");
    expect(nextUnanswered(fridge, s, false)).toBe("urgency");
    s = withAnswer(s, "urgency", "no_rush");
    expect(nextUnanswered(fridge, s, false)).toBeNull();
    expect(budgetCents(s)).toBeNull();
    expect(budgetCents(withAnswer(s, "budget", 50000))).toBe(50000);
  });

  it("withAnswer ignores an invalid trailing value and coerces a budget option string to cents", () => {
    const s = { answers: {}, trailing: {} };
    expect(withAnswer(s, "urgency", "tomorrow")).toEqual(s);
    expect(withAnswer(s, "budget", "120000").trailing.budget).toBe(120000);
    expect(withAnswer(s, "budget", "none").trailing.budget).toBe("none");
    expect(withAnswer(s, "budget", "abc")).toEqual(s);
  });
});
