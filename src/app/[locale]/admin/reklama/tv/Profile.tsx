import { BUCKETS, bucketLabel } from "@/domain/growth/uplift";
import { formatInt, formatNumber } from "@/i18n/format";

// The 24-hour profile of a TV campaign (docs/TV_ANALYTICS_PLAN.md §1):
// impressions as bars on their own scale, sessions as a line and the baseline
// as a dashed line on a shared scale, per 10-minute bucket. One SVG, no
// library, readable on the dark admin page and on the white printed report.

export function Profile({
  title,
  impressions,
  sessions,
  baseline,
  tone,
  labels,
}: {
  title: string;
  impressions: number[];
  sessions: number[];
  baseline: number[] | null;
  tone: "dark" | "light";
  labels: { impressions: string; sessions: string; baseline: string };
}) {
  const width = 720;
  const height = 220;
  const pad = { top: 16, bottom: 22, left: 2, right: 2 };
  const innerH = height - pad.top - pad.bottom;
  const step = (width - pad.left - pad.right) / BUCKETS;
  const maxImp = Math.max(1, ...impressions);
  const maxSess = Math.max(1, ...sessions, ...(baseline ?? []));
  const x = (b: number) => pad.left + b * step;
  const yImp = (v: number) => pad.top + innerH - (innerH * v) / maxImp;
  const ySess = (v: number) => pad.top + innerH - (innerH * v) / maxSess;
  const line = (series: number[]) =>
    series
      .map((v, b) => `${b === 0 ? "M" : "L"}${(x(b) + step / 2).toFixed(1)},${ySess(v).toFixed(1)}`)
      .join(" ");
  const dark = tone === "dark";
  const barFill = dark ? "fill-lime opacity-60" : "fill-lime";
  const sessStroke = dark ? "var(--color-mist)" : "#0F2A2E";
  const baseStroke = dark ? "var(--color-stone)" : "#5B6E6A";
  const text = dark ? "fill-stone" : "fill-muted";
  const hours = [0, 3, 6, 9, 12, 15, 18, 21];
  return (
    <figure className="flex flex-col gap-2" data-tv-profile>
      <figcaption className={`text-sm ${dark ? "text-stone" : "text-muted"}`}>{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        {impressions.map((v, b) =>
          v > 0 ? (
            <rect
              key={b}
              x={x(b)}
              y={yImp(v)}
              width={Math.max(1, step - 0.6)}
              height={pad.top + innerH - yImp(v)}
              className={barFill}
            >
              <title>{`${bucketLabel(b)}: ${v} ${labels.impressions}, ${sessions[b] ?? 0} ${labels.sessions}`}</title>
            </rect>
          ) : null,
        )}
        {baseline ? (
          <path d={line(baseline)} fill="none" stroke={baseStroke} strokeWidth="1.5" strokeDasharray="4 3" />
        ) : null}
        <path d={line(sessions)} fill="none" stroke={sessStroke} strokeWidth="2" strokeLinejoin="round" />
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + innerH}
          y2={pad.top + innerH}
          stroke={baseStroke}
          strokeWidth="1"
          opacity="0.5"
        />
        {hours.map((h) => (
          <text key={h} x={x(h * 6)} y={height - 6} className={`${text} text-[11px]`}>
            {`${String(h).padStart(2, "0")}:00`}
          </text>
        ))}
        <text x={width - pad.right} y={pad.top - 4} textAnchor="end" className={`${text} text-[11px]`}>
          {`${labels.impressions} ≤ ${formatInt(Math.round(maxImp))} · ${labels.sessions} ≤ ${formatNumber(maxSess, 1)}`}
        </text>
      </svg>
      <p className={`flex flex-wrap gap-4 text-xs ${dark ? "text-stone" : "text-muted"}`}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-lime" aria-hidden="true" />
          {labels.impressions}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: sessStroke }} aria-hidden="true" />
          {labels.sessions}
        </span>
        {baseline ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: baseStroke }}
              aria-hidden="true"
            />
            {labels.baseline}
          </span>
        ) : null}
      </p>
    </figure>
  );
}
