"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

// The ARIA radio group pattern for option buttons with role="radio"
// (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §7, item 2): the group is one tab
// stop (the checked option, or the first), and the arrow keys, Home and End
// move between options. With selectOnArrow the moved-to option is also
// chosen, as in a native radio group; the question flow turns that off,
// because choosing there moves on to the next question.

const radiosOf = (el: HTMLElement | null): HTMLElement[] =>
  el ? [...el.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')] : [];

const STEP: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export function RadioGroup({
  label,
  className,
  selectOnArrow = true,
  children,
}: {
  label?: string;
  className?: string;
  selectOnArrow?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Runs after every render: the checked option may have changed.
  useEffect(() => {
    const radios = radiosOf(ref.current);
    const active = radios.find((r) => r.getAttribute("aria-checked") === "true") ?? radios[0];
    for (const r of radios) r.tabIndex = r === active ? 0 : -1;
  });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const radios = radiosOf(ref.current);
    const i = radios.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || radios.length === 0) return;
    let next: number;
    if (e.key in STEP) next = (i + STEP[e.key]! + radios.length) % radios.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = radios.length - 1;
    else return;
    e.preventDefault();
    const target = radios[next]!;
    for (const r of radios) r.tabIndex = r === target ? 0 : -1;
    target.focus();
    if (selectOnArrow) target.click();
  }

  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={className}>
      {children}
    </div>
  );
}
