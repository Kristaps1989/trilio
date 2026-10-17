"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { OptionRow } from "@/ui/OptionRow";

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
}: {
  state: SetupState;
  step: "when" | "scope" | "channel";
  brand: string;
  modelCode: string;
}) {
  const t = useTranslations("radar");
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
    channel: {
      title: t("qChannel"),
      why: null,
      options: [
        { value: "push", label: t("channelPush") },
        { value: "email", label: t("channelEmail") },
        { value: "both", label: t("channelBoth") },
      ],
      pick: (v: string) =>
        go({ ...state, channels: v === "both" ? ["push", "email"] : [v as "push" | "email"] }),
    },
  }[step];

  return (
    <div className="flex flex-col gap-6 pt-4">
      <h2 className="text-[24px] font-bold leading-[1.2] text-mist">{screens.title}</h2>
      <div role="radiogroup" aria-label={screens.title} className="flex flex-col gap-2">
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
      {screens.why ? <p className="text-sm text-stone">{screens.why}</p> : null}
    </div>
  );
}
