"use client";

import { usePathname, useRouter } from "next/navigation";

// The footer's back button (spec §2). Answers live in the URL, so browser
// history is the flow's history. Screens without a step to go back to keep
// an empty square, so the footer never changes height or alignment.

const NO_BACK = new Set(["/", "/radars/apstiprinats", "/maksajums/mock"]);

export function BackButton({ label }: { label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (NO_BACK.has(pathname)) return <span aria-hidden="true" className="h-12 w-12" />;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control border-[1.5px] border-line-30 text-mist"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
