import { describe, expect, it } from "vitest";
import { getSubcategory } from "./catalog";
import {
  activeOptions,
  effectiveAnswers,
  nextQuestion,
  progress,
  sanitizeAnswers,
  validateAnswer,
  visibleQuestions,
} from "./engine";

const fridge = getSubcategory("fridge")!;
const grinder = getSubcategory("grinder")!;
const vacuum = getSubcategory("vacuum")!;
const hob = getSubcategory("hob")!;

describe("visibleQuestions / showIf", () => {
  it("shows niche height only for built-in fridges and size only for freestanding", () => {
    const builtin = visibleQuestions(fridge, { type: "builtin" }).map((q) => q.id);
    expect(builtin).toContain("niche");
    expect(builtin).not.toContain("size");
    const free = visibleQuestions(fridge, { type: "free" }).map((q) => q.id);
    expect(free).toContain("size");
    expect(free).not.toContain("niche");
  });

  it("asks the height limit only for tall fridges and skips the freezer question for wide ones", () => {
    expect(visibleQuestions(fridge, { type: "free", size: "tall" }).map((q) => q.id)).toContain(
      "height_limit",
    );
    expect(visibleQuestions(fridge, { type: "free", size: "mid" }).map((q) => q.id)).not.toContain(
      "height_limit",
    );
    expect(visibleQuestions(fridge, { type: "free", size: "wide" }).map((q) => q.id)).not.toContain(
      "freezer",
    );
  });

  it("notIn shows the question while its dependency is unanswered", () => {
    expect(visibleQuestions(fridge, {}).map((q) => q.id)).toContain("freezer");
  });

  it("hob: three-phase only for electric hobs, gas type only for gas", () => {
    const gas = visibleQuestions(hob, { g0: "gas" }).map((q) => q.id);
    expect(gas).toContain("gas");
    expect(gas).not.toContain("g2");
    const induction = visibleQuestions(hob, { g0: "induction" }).map((q) => q.id);
    expect(induction).toContain("g2");
    expect(induction).not.toContain("gas");
    expect(induction).not.toContain("width");
  });
});

describe("effectiveAnswers", () => {
  it("drops answers to questions that became hidden after going back", () => {
    const result = effectiveAnswers(fridge, { type: "builtin", niche: 178, size: "tall" });
    expect(result).toEqual({ type: "builtin", niche: 178 });
  });

  it("grinder: espresso implies burr for the hidden question", () => {
    expect(effectiveAnswers(grinder, { g0: "espresso" })).toEqual({ g0: "espresso", g1: "burr" });
    expect(visibleQuestions(grinder, { g0: "espresso" }).map((q) => q.id)).toEqual(["g0"]);
    expect(visibleQuestions(grinder, { g0: "filter" }).map((q) => q.id)).toEqual(["g0", "g1"]);
  });
});

describe("nextQuestion and progress", () => {
  it("walks the fridge flow in order", () => {
    expect(nextQuestion(fridge, {})?.id).toBe("type");
    expect(nextQuestion(fridge, { type: "free" })?.id).toBe("size");
    expect(nextQuestion(fridge, { type: "free", size: "wide" })?.id).toBe("household");
    expect(
      nextQuestion(fridge, { type: "free", size: "wide", household: "4", priorities: ["quiet"] }),
    ).toBeNull();
  });

  it("M grows when a conditional question appears", () => {
    // built-in: type, niche, freezer, household, priorities (5) + 3 trailing
    expect(progress(fridge, { type: "builtin" }, "niche")).toEqual({ n: 2, m: 8 });
    // freestanding tall: type, size, height_limit, freezer, household, priorities (6) + 3 trailing
    expect(progress(fridge, { type: "free", size: "tall" }, "height_limit")).toEqual({ n: 3, m: 9 });
    // wide skips freezer: type, size, household, priorities (4); without refurbished stock only two trailing
    expect(progress(fridge, { type: "free", size: "wide" }, "urgency", ["budget", "urgency"])).toEqual({
      n: 6,
      m: 6,
    });
  });
});

describe("validateAnswer", () => {
  const niche = fridge.questions.find((q) => q.id === "niche")!;
  const priorities = fridge.questions.find((q) => q.id === "priorities")!;
  const home = vacuum.questions.find((q) => q.id === "home")!;
  const type = fridge.questions.find((q) => q.id === "type")!;

  it("numbers accept a decimal comma and enforce the range", () => {
    expect(validateAnswer(niche, "178")).toEqual({ ok: true, value: 178 });
    expect(validateAnswer(niche, "177,5")).toEqual({ ok: true, value: 177.5 });
    expect(validateAnswer(niche, 500)).toEqual({ ok: false, reason: "out_of_range" });
    expect(validateAnswer(niche, "abc")).toEqual({ ok: false, reason: "not_a_number" });
  });

  it("single rejects unknown values", () => {
    expect(validateAnswer(type, "free")).toEqual({ ok: true, value: "free" });
    expect(validateAnswer(type, "sideways")).toEqual({ ok: false, reason: "unknown_option" });
    expect(validateAnswer(type, ["free"])).toEqual({ ok: false, reason: "unknown_option" });
  });

  it("multi enforces max_select, dedupes and lets an exclusive option win", () => {
    expect(validateAnswer(priorities, ["quiet", "energy"])).toEqual({ ok: true, value: ["quiet", "energy"] });
    expect(validateAnswer(priorities, ["quiet", "quiet"])).toEqual({ ok: true, value: ["quiet"] });
    expect(validateAnswer(priorities, ["quiet", "energy", "nofrost"])).toEqual({
      ok: false,
      reason: "too_many",
    });
    expect(validateAnswer(priorities, [])).toEqual({ ok: false, reason: "empty" });
    expect(validateAnswer(home, ["pets", "none"])).toEqual({ ok: true, value: ["none"] });
  });
});

describe("activeOptions and sanitizeAnswers", () => {
  it("passthrough options are not active", () => {
    const mop = vacuum.questions.find((q) => q.id === "mop")!;
    expect(activeOptions(mop, { mop: "no" })).toEqual([]);
    expect(activeOptions(mop, { mop: "yes" }).map((o) => o.value)).toEqual(["yes"]);
  });

  it("sanitizeAnswers drops unknown keys, invalid values and hidden questions", () => {
    const result = sanitizeAnswers(fridge, {
      type: "builtin",
      niche: "178",
      size: "tall", // hidden for built-in
      household: "9", // not an option
      evil: "<script>",
      priorities: ["quiet"],
    });
    expect(result).toEqual({ type: "builtin", niche: 178, priorities: ["quiet"] });
  });
});
