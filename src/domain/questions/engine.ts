import type { Answers, AnswerValue, Option, Question, RangeAnswer, ShowIf, Subcategory } from "./schema";

// Pure question-flow logic. No React, no DB. The UI calls these with the
// subcategory definition and the answers collected so far.

/** The shared trailing question appended to every flow: the price range. */
export const TRAILING_QUESTION_IDS = ["budget"] as const;

export function isRangeAnswer(a: AnswerValue | undefined): a is RangeAnswer {
  return typeof a === "object" && a !== null && !Array.isArray(a);
}

function answerMatches(answer: AnswerValue | undefined, values: string[]): boolean {
  if (answer === undefined || isRangeAnswer(answer)) return false;
  if (Array.isArray(answer)) return answer.some((a) => values.includes(a));
  return values.includes(String(answer));
}

export function showIfSatisfied(showIf: ShowIf | undefined, answers: Answers): boolean {
  if (!showIf) return true;
  const answer = answers[showIf.q];
  if ("in" in showIf) return answerMatches(answer, showIf.in);
  // notIn: an unanswered dependency counts as "not in", so the question shows.
  return !answerMatches(answer, showIf.notIn);
}

/**
 * Answers implied by chosen options (grinder: espresso ⇒ burr). Implied values
 * never overwrite an explicit answer to a visible question.
 */
export function impliedAnswers(sub: Subcategory, answers: Answers): Answers {
  const implied: Answers = {};
  for (const q of sub.questions) {
    const answer = answers[q.id];
    if (answer === undefined) continue;
    const chosen = Array.isArray(answer) ? answer : [String(answer)];
    for (const o of q.options) {
      if (!chosen.includes(o.value) || !o.implies) continue;
      Object.assign(implied, o.implies);
    }
  }
  return implied;
}

/** Questions currently visible, in order, given the answers so far (both stages). */
export function visibleQuestions(sub: Subcategory, answers: Answers): Question[] {
  return sub.questions.filter((q) => showIfSatisfied(q.showIf, answers));
}

/** Visible questions asked before results (core rule 1: fit, price or kind of product). */
export function flowQuestions(sub: Subcategory, answers: Answers): Question[] {
  return visibleQuestions(sub, answers).filter((q) => q.stage === "flow");
}

/** Visible questions refined on the results page (priorities, comfort features). */
export function resultsQuestions(sub: Subcategory, answers: Answers): Question[] {
  return visibleQuestions(sub, answers).filter((q) => q.stage === "results");
}

/**
 * Effective answers: explicit answers to visible questions plus implied ones.
 * Answers to questions that are now hidden (user went back and changed a
 * branch) are dropped so they can't filter products.
 */
export function effectiveAnswers(sub: Subcategory, answers: Answers): Answers {
  const visible = new Set(visibleQuestions(sub, answers).map((q) => q.id));
  const result: Answers = {};
  for (const [id, value] of Object.entries(answers)) {
    if (visible.has(id)) result[id] = value;
  }
  const implied = impliedAnswers(sub, result);
  for (const [id, value] of Object.entries(implied)) {
    if (!visible.has(id)) result[id] = value;
  }
  return result;
}

/** The first visible flow question without an answer, or null when the category questions are complete. */
export function nextQuestion(sub: Subcategory, answers: Answers): Question | null {
  for (const q of flowQuestions(sub, answers)) {
    if (answers[q.id] === undefined) return q;
  }
  return null;
}

export type Progress = { n: number; m: number };

/**
 * "Jautājums N no M". M counts the visible category questions plus the
 * trailing ones; it changes when a conditional question appears.
 */
export function progress(
  sub: Subcategory,
  answers: Answers,
  currentId: string,
  trailing: readonly string[] = TRAILING_QUESTION_IDS,
): Progress {
  const visible = flowQuestions(sub, answers);
  const ids = [...visible.map((q) => q.id), ...trailing];
  const idx = ids.indexOf(currentId);
  return { n: idx >= 0 ? idx + 1 : ids.length, m: ids.length };
}

export type ValidationResult = { ok: true; value: AnswerValue } | { ok: false; reason: string };

/** Validate a raw answer against the question. Multi answers are normalised (exclusive option wins, max_select enforced). */
export function validateAnswer(q: Question, raw: unknown): ValidationResult {
  if (q.type === "range") {
    // { min?, max? }; "any" or {} is "no limit". Bounds are clamped to the slider; a one-handle slider keeps max only.
    if (raw === "any") return { ok: true, value: {} };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return { ok: false, reason: "not_a_range" };
    const r = q.range!;
    const out: RangeAnswer = {};
    for (const key of ["min", "max"] as const) {
      const v = (raw as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === "") continue;
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, reason: "not_a_number" };
      out[key] = Math.min(r.max, Math.max(r.min, n));
    }
    if (r.bound === "max") delete out.min;
    if (out.min !== undefined && out.max !== undefined && out.min > out.max)
      return { ok: false, reason: "min_above_max" };
    return { ok: true, value: out };
  }
  if (q.type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) return { ok: false, reason: "not_a_number" };
    const { min, max } = q.input!;
    if (n < min || n > max) return { ok: false, reason: "out_of_range" };
    return { ok: true, value: n };
  }
  const values = q.options.map((o) => o.value);
  if (q.type === "single") {
    if (typeof raw !== "string" || !values.includes(raw)) return { ok: false, reason: "unknown_option" };
    return { ok: true, value: raw };
  }
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : null;
  if (!list || list.length === 0) return { ok: false, reason: "empty" };
  if (!list.every((v) => typeof v === "string" && values.includes(v)))
    return { ok: false, reason: "unknown_option" };
  const exclusive = list.find((v) => q.options.find((o) => o.value === v)?.exclusive);
  if (exclusive) return { ok: true, value: [exclusive] };
  const unique = [...new Set(list as string[])];
  if (unique.length > (q.max_select ?? 1)) return { ok: false, reason: "too_many" };
  return { ok: true, value: unique };
}

/** Options the user chose for a question (empty for number questions or no answer). */
export function chosenOptions(q: Question, answers: Answers): Option[] {
  const answer = answers[q.id];
  if (answer === undefined || q.type === "number" || q.type === "range" || isRangeAnswer(answer)) return [];
  const chosen = Array.isArray(answer) ? answer : [String(answer)];
  return q.options.filter((o) => chosen.includes(o.value));
}

/** Chosen options that actually constrain or score: passthrough ones are dropped. */
export function activeOptions(q: Question, answers: Answers): Option[] {
  return chosenOptions(q, answers).filter((o) => !o.passthrough);
}

/** Validate a whole answer map against the subcategory; unknown keys and hidden questions are dropped. */
export function sanitizeAnswers(sub: Subcategory, raw: Record<string, unknown>): Answers {
  const answers: Answers = {};
  for (const q of sub.questions) {
    if (!(q.id in raw)) continue;
    if (!showIfSatisfied(q.showIf, answers)) continue;
    const result = validateAnswer(q, raw[q.id]);
    if (result.ok) answers[q.id] = result.value;
  }
  return answers;
}
