import { describe, expect, it } from "vitest";
import { limitsFridge } from "@/domain/testing/fixtures";
import { getSubcategory } from "./catalog";
import {
  activeOptions,
  effectiveAnswers,
  flowQuestions,
  nextQuestion,
  progress,
  resultsQuestions,
  sanitizeAnswers,
  validateAnswer,
  visibleQuestions,
} from "./engine";

const fridge = getSubcategory("fridge")!;
const washer = getSubcategory("washer")!;
const q = (sub: typeof fridge, id: string) => sub.questions.find((x) => x.id === id)!;

describe("question engine", () => {
  it("built-in fridge: niche height and hinge, then doors", () => {
    const ids = flowQuestions(fridge, { install: "builtin" }).map((x) => x.id);
    expect(ids).toEqual(["install", "niche", "doors", "hinge", "household"]);
  });

  it("freestanding fridge: height, then doors; no niche or hinge", () => {
    expect(flowQuestions(fridge, { install: "free" }).map((x) => x.id)).toEqual([
      "install",
      "size",
      "doors",
      "household",
    ]);
  });

  it("priorities are a results-page question, not a flow screen", () => {
    expect(resultsQuestions(fridge, {}).map((x) => x.id)).toEqual(["priorities"]);
    expect(flowQuestions(fridge, {}).map((x) => x.id)).not.toContain("priorities");
  });

  it("next question walks the flow only", () => {
    expect(nextQuestion(fridge, {})?.id).toBe("install");
    expect(nextQuestion(fridge, { install: "free" })?.id).toBe("size");
    expect(nextQuestion(fridge, { install: "free", size: "h175", doors: "two", household: "4" })).toBeNull();
  });

  it("progress counts visible flow questions plus the price screen", () => {
    expect(progress(fridge, { install: "free" }, "size")).toEqual({ n: 2, m: 5 });
    expect(progress(fridge, { install: "builtin" }, "budget")).toEqual({ n: 6, m: 6 });
  });

  it("validates range answers: clamps to the slider, keeps max only for one-handle limits", () => {
    const height = q(limitsFridge, "height");
    expect(validateAnswer(height, { max: 186 })).toEqual({ ok: true, value: { max: 186 } });
    expect(validateAnswer(height, { min: 100, max: 999 })).toEqual({ ok: true, value: { max: 210 } });
    expect(validateAnswer(height, "any")).toEqual({ ok: true, value: {} });
    expect(validateAnswer(height, "tall").ok).toBe(false);
  });

  it("validates choices and numbers", () => {
    expect(validateAnswer(q(fridge, "size"), "h175")).toEqual({ ok: true, value: "h175" });
    expect(validateAnswer(q(fridge, "size"), "nope").ok).toBe(false);
    expect(validateAnswer(q(limitsFridge, "niche"), "177,5")).toEqual({ ok: true, value: 177.5 });
    expect(validateAnswer(q(limitsFridge, "niche"), 500).ok).toBe(false);
  });

  it("sanitize drops answers to hidden questions and unknown keys", () => {
    const a = sanitizeAnswers(fridge, { install: "free", niche: "n178", nope: 1, household: "2" });
    expect(a).toEqual({ install: "free", household: "2" });
  });

  it("effective answers drop a branch the user left", () => {
    expect(effectiveAnswers(fridge, { install: "free", niche: "n178" })).toEqual({ install: "free" });
  });

  it("passthrough answers do not constrain", () => {
    expect(activeOptions(q(fridge, "hinge"), { hinge: "unknown" })).toEqual([]);
  });

  it("washer: placement and depth only for front loaders and washer-dryers", () => {
    expect(visibleQuestions(washer, { loading: "top" }).map((x) => x.id)).not.toContain("depth");
    expect(flowQuestions(washer, { loading: "front" }).map((x) => x.id)).toEqual([
      "loading",
      "place",
      "depth",
      "household",
    ]);
  });
});
