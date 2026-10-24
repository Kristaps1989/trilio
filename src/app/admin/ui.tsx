import Link from "next/link";
import type { ReactNode } from "react";

// Building blocks of the admin pages: dark surface, the brand's tokens, one
// column on a phone (docs/ADMIN_AND_OFFERS_PLAN.md §11.11).

export function AdminTitle({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading title-results text-mist">{title}</h1>
        {sub ? <p className="text-[15px] text-stone">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Section({
  title,
  id,
  children,
  action,
}: {
  title: string;
  id: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-heading text-xl font-semibold text-mist">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One number with its label and, when known, the change against the previous period. */
export function Stat({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-1 rounded-panel-lg border-[1.5px] border-line-25 px-4 py-3">
      <span className="text-sm text-stone">{label}</span>
      <span className="font-heading text-[28px] leading-none font-bold text-mist">{value}</span>
      {delta !== undefined && delta !== null ? (
        <span className={`text-sm ${delta >= 0 ? "text-lime" : "text-warning"}`}>
          {delta >= 0 ? "+" : "−"}
          {Math.abs(delta)}%
        </span>
      ) : hint ? (
        <span className="text-sm text-stone">{hint}</span>
      ) : null}
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

/** A plain data table that scrolls sideways on a phone instead of squeezing. */
export function Table({
  caption,
  head,
  rows,
  empty,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  if (rows.length === 0 && empty) return <p className="text-[15px] text-stone">{empty}</p>;
  return (
    // Focusable so a keyboard can scroll it sideways on a phone (axe: scrollable-region-focusable).
    <div
      tabIndex={0}
      role="group"
      aria-label={caption}
      className="overflow-x-auto rounded-panel-lg border-[1.5px] border-line-25 focus-visible:outline-2 focus-visible:outline-lime"
    >
      <table className="w-full min-w-[520px] border-collapse text-left text-[15px] text-mist">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-25 text-sm text-stone">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line-20 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONES = {
  lime: "bg-lime text-night",
  neutral: "bg-chip text-mist",
  warning: "bg-warning text-night",
} as const;

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[13px] leading-tight font-bold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Filter links in one row ("Šodien · 7 d. · 30 d. · 90 d."). */
export function FilterLinks({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.active ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold ${
                i.active ? "bg-mist text-night" : "border-[1.5px] border-line-30 text-mist"
              }`}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-control border-[1.5px] border-mist/35 bg-white-5 px-3 text-[16px] text-mist placeholder:text-stone";
export const labelClass = "flex flex-col gap-1 text-[15px] font-semibold text-mist";

/**
 * One series over days as bars (dataviz skill: one hue, thin marks with
 * rounded data-ends on a baseline, 2 px gaps, recessive axis, the peak
 * labelled directly, a tooltip per bar). The table next to it is the data view.
 */
export function DayBars({
  title,
  points,
  unit,
}: {
  title: string;
  points: { day: string; value: number }[];
  unit: string;
}) {
  const width = 640;
  const height = 140;
  const pad = { top: 18, bottom: 18 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = width / Math.max(1, points.length);
  const bar = Math.max(2, step - 2);
  const peak = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? -1) ? i : best), 0);
  const scale = (v: number) => ((height - pad.top - pad.bottom) * v) / max;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm text-stone">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        <line
          x1="0"
          x2={width}
          y1={height - pad.bottom}
          y2={height - pad.bottom}
          stroke="var(--color-line-25)"
          strokeWidth="1"
        />
        {points.map((p, i) => {
          const h = scale(p.value);
          const x = i * step + 1;
          const y = height - pad.bottom - h;
          const r = Math.min(4, bar / 2, h);
          return (
            <g key={p.day} className="group">
              <rect
                x={i * step}
                y={pad.top}
                width={step}
                height={height - pad.top - pad.bottom}
                fill="transparent"
              />
              {h > 0 ? (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${y + h} Z`}
                  className="fill-lime opacity-85 group-hover:opacity-100"
                />
              ) : null}
              <title>{`${p.day}: ${p.value} ${unit}`}</title>
              {i === peak && p.value > 0 ? (
                <text x={x + bar / 2} y={y - 5} textAnchor="middle" className="fill-mist text-[12px]">
                  {p.value}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x="0" y={height - 3} className="fill-stone text-[11px]">
          {points[0]?.day.slice(5)}
        </text>
        <text x={width} y={height - 3} textAnchor="end" className="fill-stone text-[11px]">
          {points.at(-1)?.day.slice(5)}
        </text>
      </svg>
    </figure>
  );
}
