"use client";

// Brand option row (docs/BRAND.md): min-height 60 px, letter key badge,
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
      className={`flex min-h-[60px] w-full items-center gap-3 rounded-[14px] border-[1.5px] px-4 py-3 text-left transition-colors ${
        selected ? "border-lime bg-lime-18" : "border-mist-32 bg-white-5"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-bold ${
          selected ? "bg-lime text-night" : "bg-mist-32 text-mist"
        }`}
      >
        {letter}
      </span>
      <span className="flex flex-col">
        <span className="text-[17px] font-semibold leading-tight text-mist">{label}</span>
        {sublabel ? <span className="text-sm text-stone">{sublabel}</span> : null}
      </span>
    </button>
  );
}
