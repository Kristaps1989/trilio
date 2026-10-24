import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db, waitlistLeads } from "@/db";
import { encodeState } from "@/domain/flow/state";
import { getGroupOfSubcategory } from "@/domain/questions/catalog";
import { createCaller, freeTextLlmEnabled } from "@/services/llm/client";
import { MAX_FREE_TEXT_LENGTH, routeFreeText } from "@/services/llm/router";
import { Kicker, Lead, PageTitle, Screen } from "@/ui/layout";
import { FreeTextForm, type FreeTextOutcome } from "./FreeTextForm";
import { localPath } from "@/i18n/path";
import { activeLocale } from "@/i18n/active";

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
    const group = route.subcategoryId
      ? getGroupOfSubcategory(route.subcategoryId, activeLocale())
      : undefined;
    if (route.subcategoryId && group) {
      redirect(
        await localPath(
          `/izvelies/${group.id}/${route.subcategoryId}?a=${encodeState({ answers: route.prefilled, trailing: {} })}`,
        ),
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
    <Screen size="medium">
      <Kicker>{t("kicker")}</Kicker>
      <PageTitle>{t("title")}</PageTitle>
      <Lead>{t("hint")}</Lead>
      <FreeTextForm initialText={initialText} initialOutcome={outcome} />
    </Screen>
  );
}
