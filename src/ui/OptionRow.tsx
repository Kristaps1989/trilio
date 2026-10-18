"use client";

// Option row (docs/BRAND.md, prototype): min-height 60 px, 28 px letter badge,
// selected state with lime border and lime at 18 %. A real <button> so it
// is keyboard- and screen-reader-accessible.

export function OptionRow({
  letter,
  label,
  sublabel,
  selected,
  onSelect,
  role = "radio",
  analytics,
}: {
  letter: string;
  label: string;
  sublabel?: string | null;
  selected: boolean;
  onSelect: () => void;
  role?: "radio" | "checkbox";
  /** Analytics event for this choice: rendered as data-ga-* attributes (src/ui/analytics). */
  analytics?: { event: string; params: Record<string, string> };
}) {
  const gaAttributes = analytics
    ? {
        "data-ga-event": analytics.event,
        ...Object.fromEntries(
          Object.entries(analytics.params).map(([k, v]) => [`data-ga-param-${k.replace(/_/g, "-")}`, v]),
        ),
      }
    : {};
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onSelect}
      {...gaAttributes}
      className={`flex min-h-[60px] w-full items-center gap-[14px] rounded-control border-[1.5px] px-4 py-3 text-left transition-colors ${
        selected ? "border-lime bg-lime-18" : "border-mist-32 bg-white-5 hover:border-line-40"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-[1.5px] text-[13px] font-bold ${
          selected ? "border-lime bg-lime text-night" : "border-mist/50 text-mist"
        }`}
      >
        {letter}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-lg font-semibold leading-tight text-mist">{label}</span>
        {sublabel ? <span className="text-sm text-stone">{sublabel}</span> : null}
      </span>
    </button>
  );
}
