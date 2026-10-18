"use client";

import { useId } from "react";

// Native range inputs (keyboard, screen readers, 44 px touch target) styled
// as one track (docs/FILTERS_PLAN.md §4.5). `DualRange` puts two handles on
// one track for a min–max choice; `SingleRange` is an upper limit.

const pct = (v: number, min: number, max: number) => ((v - min) / Math.max(1, max - min)) * 100;

export function SingleRange({
  label,
  min,
  max,
  step,
  value,
  onChange,
  valueText,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  valueText: string;
}) {
  const id = useId();
  return (
    <div className="relative h-11">
      <div
        className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-mist/20"
        aria-hidden="true"
      >
        <div className="h-full rounded-full bg-lime" style={{ width: `${pct(value, min, max)}%` }} />
      </div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-input range-input--single"
      />
    </div>
  );
}

export function DualRange({
  labels,
  min,
  max,
  step,
  value,
  onChange,
  valueText,
}: {
  labels: { min: string; max: string };
  min: number;
  max: number;
  step: number;
  value: { min: number; max: number };
  onChange: (v: { min: number; max: number }) => void;
  valueText: (v: number) => string;
}) {
  const idMin = useId();
  const idMax = useId();
  const left = pct(value.min, min, max);
  const right = pct(value.max, min, max);
  return (
    <div className="relative h-11">
      <div
        className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-mist/20"
        aria-hidden="true"
      >
        <div
          className="absolute h-full rounded-full bg-lime"
          style={{ left: `${left}%`, width: `${right - left}%` }}
        />
      </div>
      <label htmlFor={idMin} className="sr-only">
        {labels.min}
      </label>
      <input
        id={idMin}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value.min}
        aria-valuetext={valueText(value.min)}
        onChange={(e) => onChange({ min: Math.min(Number(e.target.value), value.max), max: value.max })}
        className="range-input"
      />
      <label htmlFor={idMax} className="sr-only">
        {labels.max}
      </label>
      <input
        id={idMax}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value.max}
        aria-valuetext={valueText(value.max)}
        onChange={(e) => onChange({ min: value.min, max: Math.max(Number(e.target.value), value.min) })}
        className="range-input"
      />
    </div>
  );
}

/** Ten bars showing where the products are; bars inside the chosen range are lime. */
export function Histogram({
  buckets,
  min,
  max,
  value,
  description,
}: {
  buckets: number[];
  min: number;
  max: number;
  value: { min: number; max: number };
  description: string;
}) {
  const top = Math.max(1, ...buckets);
  const width = (max - min) / buckets.length;
  return (
    <div className="flex h-16 items-end gap-1" role="img" aria-label={description}>
      {buckets.map((n, i) => {
        const from = min + i * width;
        const to = from + width;
        const inside = to >= value.min && from <= value.max;
        return (
          <div
            key={i}
            className={`flex-1 rounded-t ${inside ? "bg-lime" : "bg-mist/20"}`}
            style={{ height: `${Math.max(6, (n / top) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
