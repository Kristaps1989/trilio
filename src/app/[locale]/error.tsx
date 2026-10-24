"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/ui/Button";
import { Kicker, Lead, PageTitle, Screen } from "@/ui/layout";

/**
 * Branded error screen for a page that failed to render. The header and
 * footer stay in place; "Mēģināt vēlreiz" re-renders the page.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Screen size="text">
      <Kicker>{t("errorKicker")}</Kicker>
      <PageTitle>{t("errorTitle")}</PageTitle>
      <Lead>{t("errorText")}</Lead>
      <div className="mt-2 flex flex-wrap gap-3">
        <Button onClick={reset}>{t("retry")}</Button>
        <ButtonLink href="/" variant="outline">
          {t("home")}
        </ButtonLink>
      </div>
      {error.digest ? <p className="text-sm text-stone">{t("code", { digest: error.digest })}</p> : null}
    </Screen>
  );
}
