import { DRAWINGS } from "./drawings";

// Line drawing for a picture card. The colour comes from the parent via
// currentColor; size it with className (e.g. "h-20 w-20").
export function Illustration({ name, className = "" }: { name: string; className?: string }) {
  const drawing = DRAWINGS[name];
  if (!drawing) return null;
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {drawing}
    </svg>
  );
}
