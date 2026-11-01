import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import sharp from "sharp";
import { it } from "vitest";
import { brandFonts, Wordmark } from "@/services/ads/creatives";
import {
  Button,
  CRITERIA,
  HEAD,
  LIME,
  MIST,
  NIGHT,
  NIGHT_DEEP,
  NIGHT_SOFT,
  OUT,
  PICKS,
  Question,
  STONE,
  Tile,
  photo,
  type Photos,
} from "./meta-ui";

// The Phase 1 Reel (docs/META_ADS_PHASE1.md R1), as motion design: every
// frame is laid out from the time (easing, staggered entrances, a tap on the
// button, the site's own "requested" state), then ffmpeg joins the frames.
// Five scenes, 14 s: the pile of models → one question → three that fit →
// the request → trilio.lv. Run: npm run creatives:reel.

const FPS = Number(process.env.REEL_FPS ?? 30);
const DURATION = Number(process.env.REEL_SECONDS ?? 14);

type Shape = "story" | "feed" | "wide";
const SIZE: Record<
  Shape,
  { w: number; h: number; top: number; bottom: number; side: number; head: number; k: number }
> = {
  story: { w: 1080, h: 1920, top: 300, bottom: 500, side: 72, head: 96, k: 1.06 },
  feed: { w: 1080, h: 1350, top: 90, bottom: 80, side: 72, head: 88, k: 0.96 },
  /** 16:9 (in-stream, Facebook video feeds on desktop): the text left, the site element right. */
  wide: { w: 1920, h: 1080, top: 64, bottom: 56, side: 96, head: 80, k: 1.1 },
};
/** The text column and the gap of the 16:9 layout. */
const WIDE_LEFT = 640;
const WIDE_GAP = 48;
/** Width the hero (question, tiles, card) can take. */
const heroWidth = (z: (typeof SIZE)[Shape], shape: Shape) =>
  shape === "wide" ? z.w - 2 * z.side - WIDE_LEFT - WIDE_GAP : z.w - 2 * z.side;

/**
 * A scene's body: the words, the site element, a footnote. Stacked in the
 * vertical shapes; side by side in 16:9, so nothing gets letterboxed.
 */
function Body({
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

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** 0 → 1 between `from` and `to` seconds, eased out (fast in, soft landing). */
const ease = (t: number, from: number, dur: number) => {
  const x = clamp((t - from) / dur);
  return 1 - Math.pow(1 - x, 3);
};
const easeInOut = (t: number, from: number, dur: number) => {
  const x = clamp((t - from) / dur);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** A soft back-ease for things that pop in: overshoots to 1.04 and settles. */
const pop = (t: number, from: number, dur: number) => {
  const x = clamp((t - from) / dur);
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/* ---------- frame pieces ---------- */

function Ground({ z, dark, children }: { z: (typeof SIZE)[Shape]; dark: boolean; children: ReactNode }) {
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

function Line({
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

function TopBar({ dark, t, at = 0 }: { dark: boolean; t: number; at?: number }) {
  const p = ease(t, at, 0.5);
  return <div style={{ display: "flex", opacity: p }}>{dark ? <Wordmark u={1.1} /> : <WordmarkDark />}</div>;
}

/** The wordmark on a light ground: dark letters, lime mark. */
function WordmarkDark() {
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

/** A stray product card in the pile: photo on white, no words (nothing is claimed). */
function Stray({
  src,
  x,
  y,
  w,
  rot,
  opacity,
}: {
  src: string;
  x: number;
  y: number;
  w: number;
  rot: number;
  opacity: number;
}) {
  const h = Math.round(w * 1.15);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        padding: Math.round(w * 0.1),
        borderRadius: Math.round(w * 0.12),
        background: "#FFFFFF",
        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        transform: `rotate(${rot}deg)`,
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori draws it into the frame */}
      <img
        src={src}
        alt=""
        width={w * 0.8}
        height={h * 0.8}
        style={{ width: w * 0.8, height: h * 0.8, objectFit: "contain" }}
      />
    </div>
  );
}

/** Deterministic pseudo-random for the pile (same video every run). */
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ---------- scenes ---------- */

const T = { pile: 0, ask: 3.0, three: 6.2, request: 9.2, end: 12.2 } as const;

function Scene(t: number, z: (typeof SIZE)[Shape], ph: Photos, shape: Shape): ReactNode {
  const keys = ["product-1", "product-2", "product-3"];

  if (t < T.ask) {
    // The pile: eighteen cards drifting in from the edges, slowly turning.
    const cards = Array.from({ length: 18 }, (_, i) => {
      const delay = 0.08 * i;
      const p = ease(t, delay, 1.2);
      const ax = rnd(i, 1) * (z.w + 200) - 100;
      const ay = rnd(i, 2) * (z.h + 300) - 150;
      const fromX = ax + (rnd(i, 3) - 0.5) * 900;
      const fromY = ay + (rnd(i, 4) - 0.5) * 900 + 400;
      const w = (150 + rnd(i, 5) * 150) * Math.sqrt(z.w / 1080);
      const rot = (rnd(i, 6) - 0.5) * 50 + Math.sin(t * 0.8 + i) * 4;
      return (
        <Stray
          key={i}
          src={ph[keys[i % 3]!]!}
          x={fromX + (ax - fromX) * p + Math.sin(t * 0.6 + i) * 8}
          y={fromY + (ay - fromY) * p + Math.cos(t * 0.5 + i) * 8}
          w={w}
          rot={rot}
          opacity={0.35 + 0.55 * p}
        />
      );
    });
    const dim = ease(t, 1.0, 0.5);
    return (
      <Ground z={z} dark>
        {cards}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: z.w,
            height: z.h,
            background: `rgba(10,31,34,${0.55 * dim})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: z.side,
            top: shape === "story" ? z.h * 0.42 : z.h * 0.36,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Line text="353 veļas mašīnas" size={z.head} color={MIST} t={t} at={1.1} />
          <Line text="3 veikalos." size={z.head} color={MIST} t={t} at={1.25} />
          <div style={{ display: "flex", height: 26 }} />
          <Line text="Kuru izvēlēties?" size={z.head} color={LIME} t={t} at={2.0} />
        </div>
      </Ground>
    );
  }

  if (t < T.three) {
    const s = t - T.ask;
    const fade = 1 - ease(s, 0, 0.35);
    const card = ease(s, 0.25, 0.7);
    return (
      <Ground z={z} dark={false}>
        <TopBar dark={false} t={s} at={0.1} />
        <Body
          shape={shape}
          head={
            <div style={{ display: "flex", flexDirection: "column", paddingTop: 34 }}>
              <Line text="Daži jautājumi." size={z.head} color={NIGHT} t={s} at={0.3} />
              <Line
                text="Tikai tie, kas izšķir."
                size={Math.round(z.head * 0.5)}
                color="#5B6E6A"
                t={s}
                at={0.5}
              />
            </div>
          }
          hero={
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                opacity: card,
                transform: `translateY(${(1 - card) * 260}px)`,
              }}
            >
              <Question
                width={Math.round(700 * z.k)}
                k={1.12 * z.k}
                selected={s >= 1.6}
                tap={s >= 1.45 && s < 1.6}
              />
            </div>
          }
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: z.w,
            height: z.h,
            background: NIGHT,
            opacity: fade,
          }}
        />
      </Ground>
    );
  }

  if (t < T.request) {
    const s = t - T.three;
    const gap = 18;
    const w = Math.floor((heroWidth(z, shape) - 2 * gap) / 3);
    return (
      <Ground z={z} dark={false}>
        <TopBar dark={false} t={10} />
        <Body
          shape={shape}
          head={
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", flexDirection: "column", paddingTop: 34 }}>
                <Line text="Trīs, kas der." size={z.head} color={NIGHT} t={s} at={0.1} />
                <Line
                  text="Ar cenām no veikaliem."
                  size={Math.round(z.head * 0.5)}
                  color="#5B6E6A"
                  t={s}
                  at={0.3}
                />
              </div>
              <div style={{ display: "flex", gap: 12, paddingTop: 26, flexWrap: "wrap" }}>
                {CRITERIA.map((c, i) => {
                  const p = pop(s, 0.5 + i * 0.12, 0.5);
                  return (
                    <div
                      key={c}
                      style={{
                        display: "flex",
                        padding: "10px 20px",
                        borderRadius: 999,
                        border: `2px solid ${NIGHT}`,
                        color: NIGHT,
                        fontSize: 24,
                        fontWeight: 700,
                        opacity: clamp(p),
                        transform: `scale(${0.8 + 0.2 * p})`,
                      }}
                    >
                      {c}
                    </div>
                  );
                })}
              </div>
            </div>
          }
          hero={
            <div style={{ display: "flex", gap, alignItems: "flex-start" }}>
              {PICKS.map((p, i) => {
                const e = ease(s, 0.35 + i * 0.18, 0.7);
                return (
                  <div
                    key={p.model}
                    style={{ display: "flex", opacity: e, transform: `translateX(${(1 - e) * 420}px)` }}
                  >
                    <Tile
                      p={p}
                      photos={ph}
                      width={w}
                      photoH={Math.round(250 * z.k)}
                      k={0.9 * z.k}
                      priceSize={38}
                      nameRows={2}
                    />
                  </div>
                );
              })}
            </div>
          }
        />
      </Ground>
    );
  }

  if (t < T.end) {
    const s = t - T.request;
    const e = pop(s, 0.1, 0.6);
    const tapAt = 1.3;
    const requested = s >= tapAt + 0.12;
    const press = s >= tapAt && s < tapAt + 0.12 ? 0.97 : 1;
    const ring = clamp((s - tapAt) / 0.7);
    const tileW = Math.round(660 * z.k);
    const hw = heroWidth(z, shape);
    return (
      <Ground z={z} dark={false}>
        <TopBar dark={false} t={10} />
        <Body
          shape={shape}
          head={
            <div style={{ display: "flex", flexDirection: "column", paddingTop: 34 }}>
              <Line text="Patīk?" size={z.head} color={NIGHT} t={s} at={0.05} />
              <Line text="Pieprasi labāku cenu." size={z.head} color={NIGHT} t={s} at={0.2} />
            </div>
          }
          hero={
            <div style={{ display: "flex", width: hw, justifyContent: "center", position: "relative" }}>
              <div style={{ display: "flex", opacity: clamp(e), transform: `scale(${0.9 + 0.1 * e})` }}>
                <Tile
                  p={PICKS[0]!}
                  photos={ph}
                  width={tileW}
                  photoH={Math.round(300 * z.k)}
                  k={1.05 * z.k * press}
                  buttons
                  requested={requested}
                />
              </div>
              {ring > 0 && ring < 1 ? (
                <div
                  style={{
                    position: "absolute",
                    left: hw / 2 - tileW / 2 + 26 * z.k,
                    bottom: 26 * z.k,
                    width: tileW - 52 * z.k,
                    height: 66 * z.k,
                    borderRadius: 999,
                    border: `4px solid ${LIME}`,
                    opacity: 1 - ring,
                    transform: `scale(${1 + ring * 0.25})`,
                  }}
                />
              ) : null}
            </div>
          }
          foot={
            <div
              style={{
                display: "flex",
                fontSize: 26,
                color: "#5B6E6A",
                lineHeight: 1.35,
                opacity: ease(s, 1.9, 0.5),
                maxWidth: 820,
              }}
            >
              Pajautāsim izplatītājam. Ja varēsim lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena
              kritīs.
            </div>
          }
        />
      </Ground>
    );
  }

  const s = t - T.end;
  const fade = 1 - ease(s, 0, 0.35);
  const logo = pop(s, 0.2, 0.7);
  return (
    <Ground z={z} dark>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 26 }}>
        <div style={{ display: "flex", opacity: clamp(logo), transform: `scale(${0.8 + 0.2 * logo})` }}>
          <Wordmark u={2.2} />
        </div>
        <Line text="trilio.lv" size={z.head} color={LIME} t={s} at={0.45} />
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: STONE,
            lineHeight: 1.35,
            opacity: ease(s, 0.7, 0.45),
            maxWidth: 860,
          }}
        >
          Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pieprasi labāku cenu.
        </div>
        <div style={{ display: "flex", width: 300, opacity: ease(s, 0.9, 0.45) }}>
          <Button text="Sākt izvēli" kind="lime" k={1.1} />
        </div>
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: z.w,
          height: z.h,
          background: "#F4F7F3",
          opacity: fade,
        }}
      />
    </Ground>
  );
}

/* ---------- output ---------- */

it("renders the Reel frame by frame", async () => {
  const ph: Photos = {
    // Small photos: the largest card in the Reel is 620 px wide and every frame decodes them again.
    "product-1": await photo("product-1", 420),
    "product-2": await photo("product-2", 420),
    "product-3": await photo("product-3", 420),
  };
  const fonts = await brandFonts();
  const dir = path.join(OUT, "R1-ka-tas-strada");
  mkdirSync(dir, { recursive: true });
  const frames = Math.round(DURATION * FPS);
  const only = process.env.REEL_SHAPES?.split(",");
  for (const [shape, tag] of [
    ["story", "9x16_1080x1920"],
    ["feed", "4x5_1080x1350"],
    ["wide", "16x9_1920x1080"],
  ] as const) {
    if (only && !only.includes(shape)) continue;
    const z = SIZE[shape];
    const tmp = path.join(OUT, `.frames-${shape}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      const png = Buffer.from(
        await new ImageResponse(
          <div style={{ display: "flex", width: z.w, height: z.h }}>{Scene(t, z, ph, shape)}</div>,
          {
            width: z.w,
            height: z.h,
            fonts,
          },
        ).arrayBuffer(),
      );
      writeFileSync(path.join(tmp, `f${String(i).padStart(4, "0")}.png`), png);
      if (process.env.REEL_BOARD) mkdirSync(path.join(OUT, ".board"), { recursive: true });
      if (process.env.REEL_BOARD)
        writeFileSync(
          path.join(OUT, ".board", `${shape}-${String(i).padStart(4, "0")}.jpg`),
          await sharp(png).jpeg({ quality: 80 }).toBuffer(),
        );
      if (i === Math.round(7.4 * FPS))
        writeFileSync(
          path.join(dir, `R1-ka-tas-strada_${tag}_cover.jpg`),
          await sharp(png).jpeg({ quality: 92 }).toBuffer(),
        );
    }
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(FPS),
        "-i",
        path.join(tmp, "f%04d.png"),
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-crf",
        "20",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        path.join(dir, `R1-ka-tas-strada_${tag}.mp4`),
      ],
      { stdio: "ignore" },
    );
    rmSync(tmp, { recursive: true, force: true });
  }
}, 1_800_000);
