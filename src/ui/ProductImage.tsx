"use client";

import Image from "next/image";
import { useState } from "react";
import { Illustration } from "@/ui/illustrations/Illustration";

// A product photo on a white tile, through our own image optimiser
// (docs/PICTURES_AND_LLM_PLAN.md). Without a usable photo, or when the shop's
// file fails to load, the subcategory's line drawing takes its place, so a
// card never shows a hole. `src` is already checked by imageSrc().

type Props = {
  src: string | null;
  alt: string;
  /** Subcategory drawing (src/ui/illustrations) used when there is no photo. */
  fallback: string | null;
  /** "stage": on a tinted panel; the photo's white ground takes the panel's tint. */
  size: "card" | "thumb" | "stage";
};

const BOX = {
  card: "h-40 w-full",
  thumb: "h-[72px] w-[72px] shrink-0",
  stage: "h-[132px] w-full sm:h-[148px]",
};
const SIZES = {
  card: "(max-width: 640px) 90vw, 320px",
  thumb: "72px",
  stage: "(max-width: 640px) 90vw, 320px",
};

export function ProductImage({ src, alt, fallback, size }: Props) {
  // The failed URL, not a flag: a new src (another product) gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && failed !== src ? src : null;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-control ${size === "stage" ? "" : "bg-white"} ${BOX[size]}`}
      data-photo={photo ? "yes" : "no"}
    >
      {photo ? (
        <Image
          src={photo}
          alt={alt}
          fill
          sizes={SIZES[size]}
          className={`object-contain p-2 ${size === "stage" ? "mix-blend-multiply" : ""}`}
          onError={() => setFailed(photo)}
        />
      ) : fallback ? (
        <Illustration
          name={fallback}
          className={size === "thumb" ? "h-12 w-12 text-card-line" : "h-24 w-24 text-card-line"}
        />
      ) : null}
    </div>
  );
}
