"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setThresholdAction } from "./actions";

// Which drops the daily e-mail reports: one setting for the whole list.

const OPTIONS = [
  { value: "any", key: "thresholdAny" },
  { value: "5", key: "threshold5" },
  { value: "10", key: "threshold10" },
] as const;

export function ThresholdPicker({ value: initial }: { value: "any" | "5" | "10" }) {
  const t = useTranslations("wishlist");
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <fieldset className="flex flex-col gap-2" disabled={pending}>
      <legend className="mb-1 text-base font-bold text-mist">{t("thresholdTitle")}</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-sm font-semibold ${
              value === o.value ? "border-lime bg-lime-18 text-mist" : "border-mist-32 text-stone"
            }`}
          >
            <input
              type="radio"
              name="threshold"
              value={o.value}
              checked={value === o.value}
              onChange={() => {
                setValue(o.value);
                start(async () => {
                  await setThresholdAction(o.value);
                  router.refresh();
                });
              }}
              className="accent-lime"
            />
            {t(o.key)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
