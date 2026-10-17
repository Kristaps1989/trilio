"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PrimaryButton } from "@/ui/PrimaryButton";

// Spec §3.4: side-by-side grid with a sticky first column, best value per
// row shaded (not when all equal), and a "differences only" toggle that
// always keeps price, model and rating.

export type CompareRow = {
  label: string;
  values: string[];
  /** Index of the best value, or null when equal / not comparable. */
  bestIndex: number | null;
  alwaysShow?: boolean;
};

export type CompareColumn = { name: string; badge: string | null };

export function CompareTable({ columns, rows }: { columns: CompareColumn[]; rows: CompareRow[] }) {
  const t = useTranslations("results");
  const [open, setOpen] = useState(false);
  const [diffOnly, setDiffOnly] = useState(false);
  const visible = rows.filter((r) => !diffOnly || r.alwaysShow || new Set(r.values).size > 1);

  return (
    <section className="flex flex-col gap-3" aria-label={t("compareTitle")}>
      <PrimaryButton variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? t("compareClose") : t("compare")}
      </PrimaryButton>
      {open ? (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-3 text-base text-mist">
            <input
              type="checkbox"
              checked={diffOnly}
              onChange={(e) => setDiffOnly(e.target.checked)}
              className="h-6 w-6 accent-lime"
            />
            {t("differencesOnly")}
          </label>
          <p className="text-sm text-stone">{t("compareBestHint")}</p>
          <div
            className="overflow-x-auto rounded-card bg-white text-night"
            tabIndex={0}
            role="region"
            aria-label={t("compareTitle")}
          >
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-white p-3 text-left font-semibold text-muted"
                  >
                    {t("compareTitle")}
                  </th>
                  {columns.map((c) => (
                    <th key={c.name} scope="col" className="min-w-[140px] p-3 text-left align-top font-bold">
                      {c.badge ? (
                        <span className="mb-1 block text-xs font-bold uppercase text-muted">{c.badge}</span>
                      ) : null}
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.label} className="border-t border-mist">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-white p-3 text-left font-semibold text-muted"
                    >
                      {r.label}
                    </th>
                    {r.values.map((v, i) => (
                      <td
                        key={i}
                        className={`p-3 align-top ${r.bestIndex === i ? "bg-best font-semibold" : ""}`}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
