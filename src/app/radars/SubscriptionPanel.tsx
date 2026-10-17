"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatDateNominative } from "@/i18n/format";
import { PrimaryButton, PrimaryLink } from "@/ui/PrimaryButton";
import { cancelSubscriptionAction, resumeSubscriptionAction } from "./actions";

// Spec §5.2 subscription block: current method, cancel with confirmation
// (two taps, no dark patterns), resume.

export type SubscriptionModel = {
  status: "pending" | "active" | "past_due" | "canceled" | "expired";
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  paymentMethodLabel: string | null;
  planName: string;
};

export function SubscriptionPanel({ subscription }: { subscription: SubscriptionModel | null }) {
  const t = useTranslations("radar");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!subscription || subscription.status === "pending" || subscription.status === "expired") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base text-stone">
          {subscription?.status === "expired" ? t("expired") : t("noSubscription")}
        </p>
        <PrimaryLink href="/radars/jauns?step=plan">{t("subscribe")}</PrimaryLink>
      </div>
    );
  }

  const end = subscription.currentPeriodEnd
    ? formatDateNominative(new Date(subscription.currentPeriodEnd))
    : "—";
  const next = subscription.nextBillingAt ? formatDateNominative(new Date(subscription.nextBillingAt)) : "—";

  return (
    <div className="flex flex-col gap-3 text-base text-mist">
      <p>
        {t("method", { label: subscription.paymentMethodLabel ?? "—", plan: subscription.planName })} ·{" "}
        {subscription.cancelAtPeriodEnd || subscription.status === "canceled"
          ? t("willEnd", { date: end })
          : t("validUntil", { date: end })}
      </p>
      {subscription.status === "past_due" ? (
        <p className="text-warning">{t("pastDue", { date: next })}</p>
      ) : null}

      {subscription.cancelAtPeriodEnd ? (
        <PrimaryButton
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await resumeSubscriptionAction();
              router.refresh();
            })
          }
        >
          {t("resumeSub")}
        </PrimaryButton>
      ) : confirming ? (
        <div
          role="alertdialog"
          aria-label={t("cancelSub")}
          className="flex flex-col gap-3 rounded-[14px] border border-warning p-4"
        >
          <p>{t("cancelConfirm", { date: end })}</p>
          <div className="flex gap-3">
            <PrimaryButton
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await cancelSubscriptionAction();
                  setConfirming(false);
                  router.refresh();
                })
              }
            >
              {t("cancelYes")}
            </PrimaryButton>
            <PrimaryButton onClick={() => setConfirming(false)}>{t("cancelNo")}</PrimaryButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 self-start rounded-xl px-2 text-base font-semibold text-warning"
        >
          {t("cancelSub")}
        </button>
      )}
    </div>
  );
}
