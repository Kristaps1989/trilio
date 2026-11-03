import type { ReactNode } from "react";
import { Wordmark } from "@/services/ads/creatives";
import { HEAD, LIME, MIST, NIGHT, NIGHT_DEEP, NIGHT_SOFT } from "./meta-ui";

// Shared motion pieces for the Meta Reels (R1 and R2): the three shapes, the
// two-column body of 16:9, easing, the light and dark grounds, the headline
// line that slides in, and the wordmark on a light ground.

export type Shape = "story" | "feed" | "wide";
export const SIZE: Record<
  Shape,
  { w: number; h: number; top: number; bottom: number; side: number; head: number; k: number }
> = {
  story: { w: 1080, h: 1920, top: 300, bottom: 500, side: 72, head: 96, k: 1.06 },
  feed: { w: 1080, h: 1350, top: 90, bottom: 80, side: 72, head: 88, k: 0.96 },
  /** 16:9 (in-stream, Facebook video feeds on desktop): the text left, the site element right. */
  wide: { w: 1920, h: 1080, top: 64, bottom: 56, side: 96, head: 80, k: 1.1 },
};
/** The text column and the gap of the 16:9 layout. */
export const WIDE_LEFT = 640;
export const WIDE_GAP = 48;
/** Width the hero (question, tiles, card) can take. */
export const heroWidth = (z: (typeof SIZE)[Shape], shape: Shape) =>
  shape === "wide" ? z.w - 2 * z.side - WIDE_LEFT - WIDE_GAP : z.w - 2 * z.side;

/**
 * A scene's body: the words, the site element, a footnote. Stacked in the
 * vertical shapes; side by side in 16:9, so nothing gets letterboxed.
 */
export function Body({
  shape,
  head,
  hero,
  foot,
}: {
  shape: Shape;
  head: ReactNode;
  hero: ReactNode;
  foot?: ReactNode;
}) {
  if (shape === "wide")
    return (
      <div style={{ display: "flex", flex: 1, gap: WIDE_GAP, alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", width: WIDE_LEFT, flexShrink: 0 }}>
          {head}
          <div style={{ display: "flex", flex: 1 }} />
          {foot}
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>{hero}</div>
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {head}
      <div style={{ display: "flex", flex: 1 }} />
      {hero}
      <div style={{ display: "flex", flex: 1 }} />
      {foot}
    </div>
  );
}

/* ---------- easing ---------- */

export const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** 0 → 1 between `from` and `to` seconds, eased out (fast in, soft landing). */
export const ease = (t: number, from: number, dur: number) => {
  const x = clamp((t - from) / dur);
  return 1 - Math.pow(1 - x, 3);
};
export const easeInOut = (t: number, from: number, dur: number) => {
  const x = clamp((t - from) / dur);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** A soft back-ease for things that pop in: overshoots to 1.04 and settles. */
export const pop = (t: number, from: number, dur: number) => {
  const x = clamp((t - from) / dur);
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/* ---------- frame pieces ---------- */

export function Ground({
  z,
  dark,
  children,
}: {
  z: (typeof SIZE)[Shape];
  dark: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: z.w,
        height: z.h,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        background: dark
          ? `linear-gradient(172deg, ${NIGHT_SOFT} 0%, ${NIGHT} 48%, ${NIGHT_DEEP} 100%)`
          : "#F4F7F3",
        color: dark ? MIST : NIGHT,
        fontFamily: "Figtree",
        padding: `${z.top}px ${z.side}px ${z.bottom}px`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -z.w * 0.1,
          top: z.h * 0.38,
          width: z.w * 1.2,
          height: z.w * 1.2,
          borderRadius: z.w * 2,
          background: dark
            ? "radial-gradient(circle, rgba(216,244,90,0.13) 0%, rgba(216,244,90,0) 62%)"
            : "radial-gradient(circle, rgba(216,244,90,0.35) 0%, rgba(216,244,90,0) 60%)",
        }}
      />
      {children}
    </div>
  );
}

export function Line({
  text,
  size,
  color,
  t,
  at,
}: {
  text: string;
  size: number;
  color: string;
  t: number;
  at: number;
}) {
  const p = ease(t, at, 0.55);
  return (
    <div
      style={{
        display: "flex",
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: "-0.03em",
        color,
        opacity: p,
        transform: `translateY(${(1 - p) * 40}px)`,
      }}
    >
      {text}
    </div>
  );
}

export function TopBar({ dark, t, at = 0 }: { dark: boolean; t: number; at?: number }) {
  const p = ease(t, at, 0.5);
  return <div style={{ display: "flex", opacity: p }}>{dark ? <Wordmark u={1.1} /> : <WordmarkDark />}</div>;
}

/** The wordmark on a light ground: dark letters, lime mark. */
export function WordmarkDark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
      <div
        style={{
          display: "flex",
          width: 44,
          height: 44,
          borderRadius: 12,
          background: LIME,
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 4,
          padding: 9,
        }}
      >
        <div style={{ display: "flex", width: 6, height: 12, borderRadius: 2, background: NIGHT }} />
        <div style={{ display: "flex", width: 6, height: 22, borderRadius: 2, background: NIGHT }} />
        <div style={{ display: "flex", width: 6, height: 7, borderRadius: 2, background: NIGHT }} />
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 36,
          color: NIGHT,
          letterSpacing: "-0.04em",
        }}
      >
        trilio
      </div>
    </div>
  );
}
