import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { loadCandidates } from "@/db/queries/catalog";
import { defaultOption, optionCounts, priceStats, questionsThatMatter } from "@/domain/flow/insight";
import { decodeState, encodeState, nextUnanswered, sequence, TRAILING } from "@/domain/flow/state";
import { flowQuestions } from "@/domain/questions/engine";
import { getGroup, getSubcategory } from "@/domain/questions/catalog";
import type { Answers, Question } from "@/domain/questions/schema";
import { Screen } from "@/ui/layout";
import { TopProgress } from "@/ui/shell/TopProgress";
import { QuestionScreen, type ScreenQuestion } from "../../QuestionScreen";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ group: string; sub: string }>;
  searchParams: Promise<{ a?: string; q?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sub } = await params;
  return { title: getSubcategory(sub)?.label ?? "" };
}

/** Answers to the flow questions before `q`, so counts show what each option would leave. */
function answersBefore(questions: Question[], answers: Answers, q: Question): Answers {
  const out: Answers = {};
  for (const x of questions) {
    if (x.id === q.id) break;
    if (answers[x.id] !== undefined) out[x.id] = answers[x.id]!;
  }
  return out;
}

/**
 * One question per screen (spec §2.2, docs/FILTERS_PLAN.md core rules): only
 * the questions that decide fit, price or the kind of product, skipped when
 * the stock makes them irrelevant, then the price range; the URL carries the answers.
 */
export default async function QuestionPage({ params, searchParams }: Props) {
  const { group, sub: subId } = await params;
  const { a, q } = await searchParams;
  const g = getGroup(group);
  const sub = getSubcategory(subId);
  if (!g || !sub || !g.subcategories.some((s) => s.id === sub.id)) notFound();

  const state = decodeState(sub, a);
  const products = await loadCandidates(db, sub.id);
  const ctx = { products, sub, answers: state.answers };
  const matter = new Set(questionsThatMatter(ctx).map((x) => x.id));
  const skip = (x: Question) => !matter.has(x.id);
  const ids = sequence(sub, state, skip);
  const currentId = q && ids.includes(q) ? q : nextUnanswered(sub, state, skip);
  const basePath = `/izvelies/${g.id}/${sub.id}`;
  if (!currentId) redirect(`/rezultati?sub=${sub.id}&a=${encodeState(state)}`);

  const t = await getTranslations();
  const flow = flowQuestions(sub, state.answers);
  const question = sub.questions.find((x) => x.id === currentId);
  let screen: ScreenQuestion;
  if (question) {
    const before = { ...ctx, answers: answersBefore(flow, state.answers, question) };
    const common = {
      id: question.id,
      title: question.title,
      why: question.why ?? null,
      help: question.help ?? null,
    };
    if (question.type === "range") {
      const r = question.range!;
      screen = {
        ...common,
        kind: "range",
        unit: r.unit,
        min: r.min,
        max: r.max,
        step: r.step,
        presets: r.presets ?? [],
      };
    } else if (question.type === "number") {
      screen = { ...common, kind: "number", input: question.input! };
    } else {
      const counts = optionCounts(before, question);
      const real = question.options.filter((o) => !o.passthrough).map((o) => counts[o.value] ?? 0);
      const sameCounts = real.length > 1 && real.every((c) => c === real[0]);
      screen = {
        ...common,
        kind: "choice",
        defaultValue: defaultOption(question, counts),
        options: question.options.map((o) => ({
          value: o.value,
          label: o.label,
          sublabel: o.sublabel ?? null,
          illustration: o.illustration,
          // Equal counts on every option say nothing; they are left out.
          count: sameCounts ? undefined : counts[o.value],
        })),
      };
    }
  } else {
    const stats = priceStats(ctx);
    screen = {
      id: TRAILING.budget,
      title: t("budget.title"),
      why: t("budget.why"),
      kind: "price",
      stats,
      presetsCents: sub.budget_steps_eur.map((eur) => eur * 100),
    };
  }

  const n = Math.max(1, ids.indexOf(currentId) + 1);
  const m = ids.length;
  return (
    <Screen>
      <TopProgress percent={(n / (m + 1)) * 100} />
      <p id="flow-progress" className="text-[15px] font-bold text-lime" aria-live="polite">
        {t("flow.progress", { n, m })}
      </p>
      <QuestionScreen key={currentId} question={screen} state={state} basePath={basePath} subId={sub.id} />
    </Screen>
  );
}
