import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { subcategoriesWithRefurbished } from "@/db/queries/catalog";
import { urgencyDate } from "@/domain/delivery/delivery";
import { decodeState, encodeState, nextUnanswered, sequence, TRAILING } from "@/domain/flow/state";
import { progress } from "@/domain/questions/engine";
import { getGroup, getSubcategory } from "@/domain/questions/catalog";
import type { Question, Subcategory } from "@/domain/questions/schema";
import { formatDateDative, formatEur } from "@/i18n/format";
import { ProgressBar } from "@/ui/ProgressBar";
import { Shell } from "@/ui/Shell";
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

function toScreen(q: Question): ScreenQuestion {
  return {
    id: q.id,
    title: q.title,
    why: q.why ?? null,
    help: q.help ?? null,
    type: q.type,
    maxSelect: q.max_select,
    input: q.input,
    options: q.options.map((o) => ({
      value: o.value,
      label: o.label,
      sublabel: o.sublabel ?? null,
      exclusive: o.exclusive,
    })),
  };
}

async function trailingScreen(id: string, sub: Subcategory): Promise<ScreenQuestion> {
  const t = await getTranslations();
  if (id === TRAILING.budget) {
    return {
      id,
      title: t("budget.title"),
      why: t("budget.why"),
      type: "single",
      options: [
        ...sub.budget_steps_eur.map((eur) => ({
          value: String(eur * 100),
          label: t("budget.upTo", { amount: formatEur(eur * 100) }),
        })),
        { value: "custom", label: t("budget.custom") },
        { value: "none", label: t("budget.notSet") },
      ],
      customNumber: { optionValue: "custom", label: t("budget.customLabel"), min: 10, max: 100000 },
    };
  }
  if (id === TRAILING.refurbished) {
    return {
      id,
      title: t("refurbished.title"),
      why: t("refurbished.why"),
      type: "single",
      options: [
        { value: "yes", label: t("refurbished.yes") },
        { value: "no", label: t("refurbished.no") },
      ],
    };
  }
  const now = new Date();
  return {
    id,
    title: t("urgency.title"),
    type: "single",
    options: [
      {
        value: "asap",
        label: t("urgency.asap"),
        sublabel: t("urgency.asapSub", { date: formatDateDative(urgencyDate("asap", now, "LV")) }),
      },
      {
        value: "two_weeks",
        label: t("urgency.twoWeeks"),
        sublabel: t("urgency.twoWeeksSub", { date: formatDateDative(urgencyDate("two_weeks", now, "LV")) }),
      },
      { value: "no_rush", label: t("urgency.noRush"), sublabel: t("urgency.noRushSub") },
    ],
  };
}

/** Spec §2.2: one question per screen; the URL carries the answers. */
export default async function QuestionPage({ params, searchParams }: Props) {
  const { group, sub: subId } = await params;
  const { a, q } = await searchParams;
  const g = getGroup(group);
  const sub = getSubcategory(subId);
  if (!g || !sub || !g.subcategories.some((s) => s.id === sub.id)) notFound();

  const state = decodeState(sub, a);
  const hasRefurbished = (await subcategoriesWithRefurbished(db)).has(sub.id);
  const ids = sequence(sub, state, hasRefurbished);
  const currentId = q && ids.includes(q) ? q : nextUnanswered(sub, state, hasRefurbished);
  const basePath = `/izvelies/${g.id}/${sub.id}`;
  if (!currentId) redirect(`/rezultati?sub=${sub.id}&a=${encodeState(state)}`);

  const question = sub.questions.find((x) => x.id === currentId);
  // Budget is stored in cents; the screen's option values are cents too, so the current answer highlights.
  const screen = question ? toScreen(question) : await trailingScreen(currentId, sub);
  const trailingIds = ids.filter((id) => !sub.questions.some((x) => x.id === id));
  const { n, m } = progress(sub, state.answers, currentId, trailingIds);
  const screenState =
    currentId === TRAILING.budget && typeof state.trailing.budget === "number"
      ? { ...state, trailing: { ...state.trailing, budget: state.trailing.budget } }
      : state;

  return (
    <Shell>
      <div className="pt-2">
        <ProgressBar n={n} m={m} />
      </div>
      <QuestionScreen key={currentId} question={screen} state={screenState} basePath={basePath} />
    </Shell>
  );
}
