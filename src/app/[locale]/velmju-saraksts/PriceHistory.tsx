import { formatEur } from "@/i18n/format";

// The price history on a wishlist card: the lowest new in-stock price per
// day, with the lowest and highest price written out (the line alone is
// not accessible, and the numbers are what a shopper compares).

export function PriceHistory({
  points,
  label,
  lowLabel,
  highLabel,
}: {
  points: { day: string; priceCents: number }[];
  label: string;
  lowLabel: string;
  highLabel: string;
}) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 64;
  const prices = points.map((p) => p.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const coords = points
    .map(
      (p, i) =>
        `${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p.priceCents - min) / span) * (h - 8) - 4).toFixed(1)}`,
    )
    .join(" ");
  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${lowLabel} ${formatEur(min)}, ${highLabel} ${formatEur(max)}`}
        className="text-lime"
      >
        <polyline
          points={coords}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="flex justify-between text-sm text-stone">
        <span>{label}</span>
        <span>
          {lowLabel} {formatEur(min)} · {highLabel} {formatEur(max)}
        </span>
      </figcaption>
    </figure>
  );
}
