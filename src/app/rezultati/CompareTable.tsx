"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/ui/Button";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="lime" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-lime"
          >
            <path d="M4 6h16M4 12h16M4 18h16M9 3v18M15 3v18" />
          </svg>
          {open ? t("compareClose") : t("compare")}
        </Button>
        {open ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-[10px] text-base text-mist">
            <input
              type="checkbox"
              checked={diffOnly}
              onChange={(e) => setDiffOnly(e.target.checked)}
              className="h-[22px] w-[22px] accent-lime"
            />
            {t("differencesOnly")}
          </label>
        ) : null}
      </div>
      {open ? (
        <div
          className="overflow-x-auto rounded-card bg-white text-night"
          tabIndex={0}
          role="region"
          aria-label={t("compareTitle")}
        >
          <table className="min-w-full border-collapse text-[15px]">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-[150px] bg-white p-[14px] text-left align-bottom text-[13px] font-normal text-muted"
                >
                  {t("compareBestHint")}
                </th>
                {columns.map((c) => (
                  <th key={c.name} scope="col" className="min-w-[180px] p-[14px] text-left align-top">
                    <span className="flex flex-col items-start gap-1.5">
                      {c.badge ? (
                        <span className="inline-flex rounded-full bg-card-pill px-3 py-[5px] text-[13px] font-bold">
                          {c.badge}
                        </span>
                      ) : null}
                      <strong className="text-base leading-tight font-bold">{c.name}</strong>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.label}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-t border-card-line bg-white px-[14px] py-3 text-left text-sm font-semibold text-muted"
                  >
                    {r.label}
                  </th>
                  {r.values.map((v, i) => (
                    <td
                      key={i}
                      className={`border-t border-card-line px-[14px] py-3 align-top leading-[1.4] ${
                        r.bestIndex === i ? "bg-best font-bold" : ""
                      }`}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
