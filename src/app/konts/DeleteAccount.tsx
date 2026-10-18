"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/ui/Button";
import { deleteAccountAction } from "./actions";

export function DeleteAccount() {
  const t = useTranslations("account");
  const tr = useTranslations("radar");
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          {t("delete")}
        </Button>
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-label={t("delete")} className="flex flex-col gap-3">
      <p className="text-base text-mist">{t("deleteConfirm")}</p>
      <div className="flex flex-wrap gap-[10px]">
        <Button variant="danger" disabled={pending} onClick={() => start(() => deleteAccountAction())}>
          {t("deleteYes")}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)}>
          {tr("cancelNo")}
        </Button>
      </div>
    </div>
  );
}
