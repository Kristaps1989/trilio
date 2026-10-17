"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { PrimaryButton } from "@/ui/PrimaryButton";
import { deleteAccountAction } from "./actions";

export function DeleteAccount() {
  const t = useTranslations("account");
  const tr = useTranslations("radar");
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <PrimaryButton variant="secondary" onClick={() => setConfirming(true)}>
        {t("delete")}
      </PrimaryButton>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-label={t("delete")}
      className="flex flex-col gap-3 rounded-[14px] border border-warning p-4"
    >
      <p className="text-base text-mist">{t("deleteConfirm")}</p>
      <div className="flex gap-3">
        <PrimaryButton
          variant="secondary"
          disabled={pending}
          onClick={() => start(() => deleteAccountAction())}
        >
          {t("deleteYes")}
        </PrimaryButton>
        <PrimaryButton onClick={() => setConfirming(false)}>{tr("cancelNo")}</PrimaryButton>
      </div>
    </div>
  );
}
