"use client";

import { useTranslations } from "next-intl";
import { DESCRIPTION_MAX, type DescriptionIssue } from "@/domain/offers/alternative";
import { inputClass, labelClass } from "../ui";

// "Trilio apraksts" (docs/ALTERNATIVE_OFFER_PLAN.md §3.4): the admin's own words,
// shown under that heading so it is clear Trilio wrote them; the honesty check
// runs as they type and blocks sending while something is wrong.

export function DescriptionField({
  value,
  onChange,
  problems,
}: {
  value: string;
  onChange: (v: string) => void;
  problems: DescriptionIssue[];
}) {
  const t = useTranslations("admin.pictures");
  return (
    <div className="flex flex-col gap-1">
      <label className={labelClass}>
        {t("description")}
        <textarea
          name="description"
          rows={4}
          maxLength={DESCRIPTION_MAX}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="description-hint"
          className={`${inputClass} py-2`}
        />
      </label>
      <p id="description-hint" className="text-sm text-stone">
        {t("descriptionHint", { left: DESCRIPTION_MAX - value.length })}
      </p>
      {problems.length ? (
        <ul role="alert" className="text-sm font-semibold text-warning" data-description-problems>
          {problems.map((p) => (
            <li key={p}>{t(`problem.${p}`)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
