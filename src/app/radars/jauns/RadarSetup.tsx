"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { OptionRow } from "@/ui/OptionRow";
import { PageTitle } from "@/ui/layout";
import { WhyLine } from "../../izvelies/QuestionScreen";

// Spec §5.1 steps 1–3 as one-question screens; each answer goes into the
// URL so back works and the state survives the sign-in and payment redirects.

export type SetupState = {
  productId: string | null;
  searchSessionId: string | null;
  threshold: "any" | "5" | "10" | null;
  scope: "only" | "brand" | "any" | null;
  channels: ("push" | "email")[];
};

const LETTERS = ["A", "B", "C"];

function toUrl(state: SetupState, step?: string): string {
  const p = new URLSearchParams();
  if (state.productId) p.set("product", state.productId);
  if (state.searchSessionId) p.set("s", state.searchSessionId);
  if (state.threshold) p.set("threshold", state.threshold);
  if (state.scope) p.set("scope", state.scope);
  if (state.channels.length) p.set("channels", state.channels.join(","));
  if (step) p.set("step", step);
  return `/radars/jauns?${p.toString()}`;
}

export function RadarSetup({
  state,
  step,
  brand,
  modelCode,
  description,
}: {
  state: SetupState;
  step: "when" | "scope";
  brand: string;
  modelCode: string;
  /** Product name and current price under the title. */
  description?: string | null;
}) {
  const t = useTranslations("radar");
  const tf = useTranslations("flow");
  const router = useRouter();
  const [flash, setFlash] = useState<string | null>(null);

  function go(next: SetupState) {
    // Auto-advance after the selection flash (spec §2); a stray push after unmount is harmless.
    setTimeout(() => router.push(toUrl(next)), 260);
  }

  const screens = {
    when: {
      title: t("qWhen"),
      why: null,
      options: [
        { value: "any", label: t("whenAny") },
        { value: "5", label: t("when5") },
        { value: "10", label: t("when10") },
      ],
      pick: (v: string) => go({ ...state, threshold: v as SetupState["threshold"] }),
    },
    scope: {
      title: t("qScope"),
      why: t("scopeWhy"),
      options: [
        {
          value: "only",
          label: t("scopeOnly"),
          sublabel: modelCode ? t("scopeOnlySub", { code: modelCode }) : null,
        },
        { value: "brand", label: t("scopeBrand", { brand: brand || "—" }) },
        { value: "any", label: t("scopeAny") },
      ],
      pick: (v: string) => go({ ...state, scope: v as SetupState["scope"] }),
    },
  }[step];

  return (
    <>
      <PageTitle>{screens.title}</PageTitle>
      {description ? <p className="-mt-1.5 text-lg leading-[1.45] text-stone">{description}</p> : null}
      <div
        role="radiogroup"
        aria-label={screens.title}
        className="mt-1.5 flex max-w-[540px] flex-col gap-[10px]"
      >
        {screens.options.map((o, i) => (
          <OptionRow
            key={o.value}
            letter={LETTERS[i]!}
            label={o.label}
            sublabel={"sublabel" in o ? o.sublabel : null}
            selected={flash === o.value}
            onSelect={() => {
              setFlash(o.value);
              screens.pick(o.value);
            }}
          />
        ))}
      </div>
      {screens.why ? <WhyLine label={tf("why")}>{screens.why}</WhyLine> : null}
    </>
  );
}
