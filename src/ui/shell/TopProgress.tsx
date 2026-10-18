/**
 * The 4 px progress bar across the top of the viewport (prototype). The root
 * layout always draws the empty track; a flow screen draws the lime part over
 * it. Screen readers get the "Jautājums N no M" counter instead.
 */
export function TopProgress({ percent }: { percent: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-1">
      <div className="h-full bg-lime transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}
