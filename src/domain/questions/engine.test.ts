import { describe, expect, it } from "vitest";
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
  it("built-in fridge: niche height and hinge instead of the height limit", () => {
    const ids = flowQuestions(fridge, { form: "builtin" }).map((x) => x.id);
    expect(ids).toEqual(["form", "niche", "hinge", "household"]);
  });

  it("freestanding fridge: height limit, no niche or hinge", () => {
    expect(flowQuestions(fridge, { form: "combi" }).map((x) => x.id)).toEqual([
      "form",
      "height",
      "household",
    ]);
  });

  it("small fridge skips the height question", () => {
    expect(flowQuestions(fridge, { form: "compact" }).map((x) => x.id)).toEqual(["form", "household"]);
  });

  it("priorities are a results-page question, not a flow screen", () => {
    expect(resultsQuestions(fridge, {}).map((x) => x.id)).toEqual(["priorities"]);
    expect(flowQuestions(fridge, {}).map((x) => x.id)).not.toContain("priorities");
  });

  it("next question walks the flow only", () => {
    expect(nextQuestion(fridge, {})?.id).toBe("form");
    expect(nextQuestion(fridge, { form: "combi" })?.id).toBe("height");
    expect(nextQuestion(fridge, { form: "combi", height: { max: 186 }, household: "4" })).toBeNull();
  });

  it("progress counts visible flow questions plus the price screen", () => {
    expect(progress(fridge, { form: "combi" }, "height")).toEqual({ n: 2, m: 4 });
    expect(progress(fridge, { form: "builtin" }, "budget")).toEqual({ n: 5, m: 5 });
  });

  it("validates range answers: clamps to the slider, keeps max only for one-handle limits", () => {
    expect(validateAnswer(q(fridge, "height"), { max: 186 })).toEqual({ ok: true, value: { max: 186 } });
    expect(validateAnswer(q(fridge, "height"), { min: 100, max: 999 })).toEqual({
      ok: true,
      value: { max: 210 },
    });
    expect(validateAnswer(q(fridge, "height"), "any")).toEqual({ ok: true, value: {} });
    expect(validateAnswer(q(fridge, "height"), "tall").ok).toBe(false);
  });

  it("validates choices and numbers", () => {
    expect(validateAnswer(q(fridge, "form"), "combi")).toEqual({ ok: true, value: "combi" });
    expect(validateAnswer(q(fridge, "form"), "nope").ok).toBe(false);
    expect(validateAnswer(q(fridge, "niche"), "177,5")).toEqual({ ok: true, value: 177.5 });
    expect(validateAnswer(q(fridge, "niche"), 500).ok).toBe(false);
  });

  it("sanitize drops answers to hidden questions and unknown keys", () => {
    const a = sanitizeAnswers(fridge, { form: "compact", height: { max: 150 }, nope: 1, household: "2" });
    expect(a).toEqual({ form: "compact", household: "2" });
  });

  it("effective answers drop a branch the user left", () => {
    expect(effectiveAnswers(fridge, { form: "combi", niche: 178 })).toEqual({ form: "combi" });
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
