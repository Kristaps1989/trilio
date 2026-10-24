"use client";

import { useState } from "react";

/**
 * The EAN note with the "Kā mēs izvēlamies un prioritizējam?" toggle beside it,
 * opening the bordered explanation panel (CLAUDE.md rule 4, prototype).
 */
export function HowWeRank({
  note,
  toggle,
  title,
  items,
}: {
  note: string;
  toggle: string;
  title: string;
  items: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone">
        <span>{note}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="how-we-rank"
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 font-bold text-lime underline underline-offset-2"
        >
          {toggle}
        </button>
      </div>
      {open ? (
        <section
          id="how-we-rank"
          aria-label={title}
          className="flex max-w-[820px] flex-col gap-[10px] rounded-panel border-[1.5px] border-line-25 px-5 py-[18px]"
        >
          <h2 className="font-heading text-xl font-semibold text-mist">{title}</h2>
          <ul className="flex list-disc flex-col gap-2 pl-[18px] text-[15px] leading-normal text-panel-text">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
