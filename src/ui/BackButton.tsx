"use client";

import { useRouter } from "next/navigation";

/** Every step has a back button (spec §2); browser history keeps answers because state lives in the URL. */
export function BackButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="flex min-h-11 items-center rounded-xl px-3 text-base font-semibold text-mist"
    >
      ← {label}
    </button>
  );
}
