"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatDateNominative } from "@/i18n/format";
import { Button, ButtonLink } from "@/ui/Button";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-stone">
          {subscription?.status === "expired" ? t("expired") : t("noSubscription")}
        </p>
        <ButtonLink href="/radars/jauns?step=plan" size="sm">
          {t("subscribe")}
        </ButtonLink>
      </div>
    );
  }

  const end = subscription.currentPeriodEnd
    ? formatDateNominative(new Date(subscription.currentPeriodEnd))
    : "—";
  const next = subscription.nextBillingAt ? formatDateNominative(new Date(subscription.nextBillingAt)) : "—";

  return (
    <div className="flex flex-col gap-[14px] text-base text-mist">
      <div className="flex items-center gap-3 rounded-[14px] bg-mist/8 px-4 py-[14px]">
        <span
          aria-hidden="true"
          className="flex h-[30px] w-11 shrink-0 items-center justify-center rounded-md bg-mist text-[11px] font-extrabold text-night"
        >
          {t("cardBadge")}
        </span>
        <span className="flex min-w-0 flex-col">
          <strong className="font-bold">
            {t("method", { label: subscription.paymentMethodLabel ?? "—", plan: subscription.planName })}
          </strong>
          <span className="text-sm text-stone">
            {subscription.cancelAtPeriodEnd || subscription.status === "canceled"
              ? t("willEnd", { date: end })
              : t("validUntil", { date: end })}
          </span>
        </span>
      </div>
      {subscription.status === "past_due" ? (
        <p className="text-warning">{t("pastDue", { date: next })}</p>
      ) : null}

      {subscription.cancelAtPeriodEnd ? (
        <div>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await resumeSubscriptionAction();
                router.refresh();
              })
            }
          >
            {t("resumeSub")}
          </Button>
        </div>
      ) : confirming ? (
        <div role="alertdialog" aria-label={t("cancelSub")} className="flex flex-col gap-3">
          <p>{t("cancelConfirm", { date: end })}</p>
          <div className="flex flex-wrap gap-[10px]">
            <Button
              variant="danger"
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
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("cancelNo")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="link" size="sm" className="px-1" onClick={() => setConfirming(true)}>
            {t("cancelSub")}
          </Button>
        </div>
      )}
    </div>
  );
}
