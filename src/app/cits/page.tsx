import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db, waitlistLeads } from "@/db";
import { encodeState } from "@/domain/flow/state";
import { getGroupOfSubcategory } from "@/domain/questions/catalog";
import { createCaller, freeTextLlmEnabled } from "@/services/llm/client";
import { MAX_FREE_TEXT_LENGTH, routeFreeText } from "@/services/llm/router";
import { Shell } from "@/ui/Shell";
import { FreeTextForm, type FreeTextOutcome } from "./FreeTextForm";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ text?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("freeText");
  return { title: t("title") };
}

/**
 * Spec §2.1 step 3: "Kaut kas cits — pastāstīšu saviem vārdiem". Works
 * without JavaScript: a plain GET with ?text= is routed here on the server;
 * with JavaScript the form calls /api/free-text and navigates client-side.
 */
export default async function FreeTextPage({ searchParams }: Props) {
  const { text } = await searchParams;
  const t = await getTranslations("freeText");

  let outcome: FreeTextOutcome = "idle";
  const initialText = (text ?? "").slice(0, MAX_FREE_TEXT_LENGTH);
  if (initialText.trim()) {
    const route = await routeFreeText(initialText, {
      caller: createCaller(db),
      llmEnabled: freeTextLlmEnabled(),
    });
    const group = route.subcategoryId ? getGroupOfSubcategory(route.subcategoryId) : undefined;
    if (route.subcategoryId && group) {
      redirect(
        `/izvelies/${group.id}/${route.subcategoryId}?a=${encodeState({ answers: route.prefilled, trailing: {} })}`,
      );
    }
    if (route.outOfScope) {
      await db
        .insert(waitlistLeads)
        .values({ email: "", freeText: initialText, source: "free_text" })
        .catch(() => undefined);
    }
    outcome = route.outOfScope ? "out_of_scope" : "not_understood";
  }

  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("title")}</h1>
      <p className="mt-2 text-base text-stone">{t("hint")}</p>
      <FreeTextForm initialText={initialText} initialOutcome={outcome} />
    </Shell>
  );
}
