import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { BEST_LABEL } from "@/domain/social/captions";
import type { PriceTrend } from "@/domain/social/price-trend";
import type { ReelPick, ReelScene, ReelScript } from "@/domain/social/reel-script";
import { formatEur } from "@/i18n/format";
import { brandFonts, Drawing, Wordmark } from "@/services/ads/creatives";
import { loadPhoto, STORY_SIZE } from "./render";

// The pictures of the scene Reel (src/domain/social/reel-script.ts), drawn for a phone held
// upright: 1080 × 1920, the product large, few words, big numbers. The top ~250 px and the
// bottom ~420 px stay free of words for the Reels interface (name, caption, buttons), and the
// right edge low down is left to its like and share buttons.

const NIGHT = "#0F2A2E";
const NIGHT_DEEP = "#081A1D";
const NIGHT_SOFT = "#163A3F";
const LIME = "#D8F45A";
const MIST = "#F2F5F2";
const STONE = "#A9BDB9";
const HEAD = "Space Grotesk";
const X = 72;
const TOP = 196;
const W = STORY_SIZE.width - 2 * X;
const GLASS = "rgba(242,245,242,0.06)";
const GLASS_EDGE = "rgba(242,245,242,0.12)";

type Photos = Map<string, string | undefined>;
const eur = (cents: number) => formatEur(cents, "lv");

/* ---------- atoms ---------- */

function Ground({ children, lime = false }: { children: ReactNode; lime?: boolean }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Figtree",
        color: lime ? NIGHT : MIST,
        background: lime
          ? LIME
          : `linear-gradient(170deg, ${NIGHT_SOFT} 0%, ${NIGHT} 38%, ${NIGHT_DEEP} 100%)`,
        padding: `${TOP}px ${X}px 0`,
      }}
    >
      {lime ? null : (
        <div
          style={{
            position: "absolute",
            right: -460,
            bottom: -260,
            width: 1300,
            height: 1300,
            borderRadius: 650,
            background: "radial-gradient(circle, rgba(216,244,90,0.14) 0%, rgba(216,244,90,0) 62%)",
          }}
        />
      )}
      {children}
    </div>
  );
}

/** The scenes as marks along the top, the current one lit, as Stories show their parts. */
function TopBar({ at, of, lime = false }: { at: number; of: number; lime?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
      <Wordmark u={1.15} />
      <div style={{ display: "flex", gap: 8 }}>
        {Array.from({ length: of }, (_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              width: i === at ? 44 : 14,
              height: 14,
              borderRadius: 7,
              background:
                i <= at ? (lime ? NIGHT : LIME) : lime ? "rgba(15,42,46,0.2)" : "rgba(242,245,242,0.2)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Eyebrow({ text, color = LIME }: { text: string; color?: string }) {
  return (
    <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: "0.14em", color }}>
      {text.toUpperCase()}
    </div>
  );
}

function Pill({ text, tone }: { text: string; tone: "lime" | "glass" | "night" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        fontSize: 28,
        fontWeight: 700,
        padding: "10px 24px",
        borderRadius: 99,
        background: tone === "lime" ? LIME : tone === "night" ? NIGHT : GLASS,
        color: tone === "lime" ? NIGHT : tone === "night" ? LIME : MIST,
        border: tone === "glass" ? `2px solid ${GLASS_EDGE}` : "none",
      }}
    >
      {text}
    </div>
  );
}

/** The product's photo on white (feed photos are shot on white); the category's drawing without one. */
function Tile({
  pick,
  photos,
  subcategoryId,
  width,
  height,
  radius = 44,
}: {
  pick: ReelPick;
  photos: Photos;
  subcategoryId: string;
  width: number;
  height: number;
  radius?: number;
}) {
  const src = pick.image ? photos.get(pick.image) : undefined;
  const inset = Math.round(Math.min(width, height) * 0.07);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        borderRadius: radius,
        background: "#FFFFFF",
        padding: inset,
        boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
        flexShrink: 0,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- satori draws it into the JPEG; nothing reaches a browser
        <img
          src={src}
          alt=""
          width={width - 2 * inset}
          height={height - 2 * inset}
          style={{ width: width - 2 * inset, height: height - 2 * inset, objectFit: "contain" }}
        />
      ) : (
        <Drawing subcategoryId={subcategoryId} size={Math.min(width, height) * 0.6} />
      )}
    </div>
  );
}

function Price({ text, size, color = LIME }: { text: string; size: number; color?: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 0.92,
        letterSpacing: "-0.045em",
        color,
      }}
    >
      {text}
    </div>
  );
}

function Name({ text, size, maxWidth = W }: { text: string; size: number; maxWidth?: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: "-0.02em",
        maxWidth,
      }}
    >
      {text}
    </div>
  );
}

/** ✓, + or − in a round mark: lime for a strength, glass for what it gives up. */
function Mark({ mark }: { mark: "✓" | "+" | "−" }) {
  const good = mark !== "−";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 48,
        height: 48,
        borderRadius: 24,
        flexShrink: 0,
        background: good ? LIME : "rgba(242,245,242,0.14)",
        color: good ? NIGHT : MIST,
        fontSize: 32,
        fontWeight: 700,
      }}
    >
      {mark === "✓" ? (
        // Drawn: the brand fonts have no check mark.
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke={NIGHT}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        mark
      )}
    </div>
  );
}

/** The shop's price per day as a stepped line, today's price as a lit dot at its end. */
function PriceLine({ trend, width, height }: { trend: PriceTrend; width: number; height: number }) {
  const pts = trend.points;
  const lo = trend.lowCents;
  const hi = trend.highCents;
  const span = hi - lo || 1;
  const pad = 26;
  // Placed by date, so a day without a reading keeps the price before it.
  const t0 = Date.parse(pts[0]!.day);
  const days = Math.max(1, (Date.parse(pts[pts.length - 1]!.day) - t0) / 86_400_000);
  const x = (i: number) => pad + ((width - 2 * pad) * (Date.parse(pts[i]!.day) - t0)) / 86_400_000 / days;
  // A steady price is drawn in the middle; a changing one fills the height.
  const y = (c: number) => (hi === lo ? height / 2 : pad + (height - 2 * pad) * (1 - (c - lo) / span));
  let d = `M ${x(0).toFixed(1)} ${y(pts[0]!.priceCents).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${x(i).toFixed(1)} V ${y(pts[i]!.priceCents).toFixed(1)}`;
  const area = `${d} V ${height} H ${x(0).toFixed(1)} Z`;
  const lastX = x(pts.length - 1);
  const lastY = y(pts[pts.length - 1]!.priceCents);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={LIME} stopOpacity="0.32" />
          <stop offset="100%" stopColor={LIME} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#fill)" />
      <path d={d} fill="none" stroke={LIME} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="22" fill={LIME} fillOpacity="0.25" />
      <circle cx={lastX} cy={lastY} r="12" fill={LIME} />
    </svg>
  );
}

/* ---------- scenes ---------- */

function Hook({
  s,
  at,
  of,
  photos,
  sub,
}: {
  s: Extract<ReelScene, { kind: "hook" }>;
  at: number;
  of: number;
  photos: Photos;
  sub: string;
}) {
  const tilt = [-7, 0, 7];
  const lift = [70, 0, 70];
  return (
    <Ground>
      <TopBar at={at} of={of} />
      <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 70 }}>
        <Eyebrow text={s.eyebrow} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Name text={s.headline} size={100} />
          <div style={{ display: "flex", color: LIME }}>
            <Name text={s.accent} size={100} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 0, marginTop: 120 }}>
        {s.picks.map((p, i) => (
          <div
            key={p.letter}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 22,
              marginTop: lift[i],
              marginLeft: i === 0 ? 0 : -30,
              transform: `rotate(${tilt[i] ?? 0}deg)`,
            }}
          >
            <Tile pick={p} photos={photos} subcategoryId={sub} width={318} height={440} radius={36} />
            <Pill text={p.price} tone={p.best ? "lime" : "glass"} />
          </div>
        ))}
      </div>
    </Ground>
  );
}

function ProductHero({
  s,
  at,
  of,
  photos,
  sub,
}: {
  s: Extract<ReelScene, { kind: "product" }>;
  at: number;
  of: number;
  photos: Photos;
  sub: string;
}) {
  const p = s.pick;
  return (
    <Ground>
      <TopBar at={at} of={of} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 44 }}>
        <Eyebrow text={[p.letter, p.tier].filter(Boolean).join(" · ")} />
        {p.best ? <Pill text={BEST_LABEL} tone="lime" /> : null}
      </div>
      <div style={{ display: "flex", marginTop: 30 }}>
        <Tile pick={p} photos={photos} subcategoryId={sub} width={W} height={720} radius={52} />
      </div>
      <div style={{ display: "flex", marginTop: 40 }}>
        <Name text={p.name} size={p.name.length > 34 ? 50 : 60} maxWidth={W - 60} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginTop: 26 }}>
        <Price text={p.price} size={136} />
        <div style={{ display: "flex", fontSize: 32, color: STONE, paddingBottom: 12 }}>
          šodien · {p.shop}
        </div>
      </div>
    </Ground>
  );
}

function ProductFacts({
  s,
  at,
  of,
  photos,
  sub,
}: {
  s: Extract<ReelScene, { kind: "product" }>;
  at: number;
  of: number;
  photos: Photos;
  sub: string;
}) {
  const p = s.pick;
  const t = s.trend;
  const good = t?.status === "below" || t?.status === "lowest";
  const notes = s.notes.slice(0, t ? 3 : 4);
  return (
    <Ground>
      <TopBar at={at} of={of} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 44 }}>
        <Eyebrow text={[p.letter, p.tier].filter(Boolean).join(" · ")} />
        {p.best ? <Pill text={BEST_LABEL} tone="lime" /> : null}
      </div>
      <div style={{ display: "flex", gap: 36, marginTop: 30, alignItems: "center" }}>
        <Tile pick={p} photos={photos} subcategoryId={sub} width={360} height={400} radius={40} />
        <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
          <Name text={p.name} size={p.name.length > 40 ? 38 : 44} maxWidth={W - 396} />
          <Price text={p.price} size={104} />
          <div style={{ display: "flex", fontSize: 30, color: STONE }}>šodien · {p.shop}</div>
        </div>
      </div>
      {t ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 40,
            padding: "30px 34px 26px",
            borderRadius: 40,
            background: GLASS,
            border: `2px solid ${GLASS_EDGE}`,
            width: W - 70,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: STONE }}>Cena 30 dienās</div>
            <Pill text={t.label} tone={good ? "lime" : "glass"} />
          </div>
          <div style={{ display: "flex", marginTop: 22 }}>
            <PriceLine trend={t} width={W - 70 - 68} height={250} />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 12,
              fontSize: 26,
              color: STONE,
            }}
          >
            <div style={{ display: "flex" }}>pirms 30 dienām</div>
            <div style={{ display: "flex" }}>
              {t.lowCents === t.highCents ? eur(t.lowCents) : `${eur(t.lowCents)} – ${eur(t.highCents)}`}
            </div>
            <div style={{ display: "flex" }}>šodien</div>
          </div>
        </div>
      ) : s.specs.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 44, width: W - 70 }}>
          {s.specs.map((x) => (
            <Pill key={x} text={x} tone="glass" />
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 44, width: W - 100 }}>
        {notes.map((n) => (
          <div key={n.text} style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <Mark mark={n.mark} />
            <div style={{ display: "flex", fontSize: 38, lineHeight: 1.2 }}>{n.text}</div>
          </div>
        ))}
        {t && notes.length < 2 && s.specs.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 6 }}>
            {s.specs.slice(0, 3).map((x) => (
              <Pill key={x} text={x} tone="glass" />
            ))}
          </div>
        ) : null}
      </div>
    </Ground>
  );
}

function Compare({
  s,
  at,
  of,
  photos,
  sub,
}: {
  s: Extract<ReelScene, { kind: "compare" }>;
  at: number;
  of: number;
  photos: Photos;
  sub: string;
}) {
  const max = Math.max(...s.rows.map((r) => r.priceCents));
  return (
    <Ground>
      <TopBar at={at} of={of} />
      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 64 }}>
        <Eyebrow text={s.eyebrow} />
        <Name text={s.headline} size={96} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 48 }}>
        {s.rows.map((r) => (
          <div
            key={r.letter}
            style={{
              display: "flex",
              gap: 28,
              alignItems: "center",
              padding: 22,
              borderRadius: 40,
              background: r.best ? "rgba(216,244,90,0.10)" : GLASS,
              border: `2px solid ${r.best ? "rgba(216,244,90,0.55)" : GLASS_EDGE}`,
              width: W - 40,
            }}
          >
            <Tile pick={r} photos={photos} subcategoryId={sub} width={190} height={210} radius={28} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    color: LIME,
                  }}
                >
                  {[r.letter, r.tier].filter(Boolean).join(" · ").toUpperCase()}
                </div>
                {r.best ? (
                  <div
                    style={{
                      display: "flex",
                      fontSize: 22,
                      fontWeight: 700,
                      padding: "4px 14px",
                      borderRadius: 99,
                      background: LIME,
                      color: NIGHT,
                    }}
                  >
                    {BEST_LABEL}
                  </div>
                ) : null}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 32,
                  fontWeight: 600,
                  lineHeight: 1.15,
                  maxHeight: 76,
                  overflow: "hidden",
                }}
              >
                {r.name}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <Price text={r.price} size={56} color={r.best ? LIME : MIST} />
                <div
                  style={{
                    display: "flex",
                    height: 12,
                    borderRadius: 6,
                    width: Math.round(200 * (r.priceCents / max)),
                    background: r.best ? LIME : "rgba(242,245,242,0.3)",
                  }}
                />
              </div>
              {r.note ? (
                <div
                  style={{ display: "flex", fontSize: 26, color: STONE, maxHeight: 34, overflow: "hidden" }}
                >
                  {r.note}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Ground>
  );
}

function Cta({
  s,
  at,
  of,
  photos,
  picks,
  sub,
}: {
  s: Extract<ReelScene, { kind: "cta" }>;
  at: number;
  of: number;
  photos: Photos;
  picks: ReelPick[];
  sub: string;
}) {
  return (
    <Ground lime>
      <TopBar at={at} of={of} lime />
      <div style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: 90 }}>
        <Eyebrow text={s.eyebrow} color={NIGHT} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Name text={s.headline} size={112} />
          <div style={{ display: "flex", color: "rgba(15,42,46,0.62)" }}>
            <Name text={s.accent} size={112} />
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 40, lineHeight: 1.3, maxWidth: 820 }}>{s.sub}</div>
      </div>
      <div style={{ display: "flex", gap: 22, marginTop: 70 }}>
        {picks.map((p) => (
          <Tile
            key={p.letter}
            pick={p}
            photos={photos}
            subcategoryId={sub}
            width={200}
            height={220}
            radius={30}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 22,
          marginTop: 70,
          padding: "30px 52px",
          borderRadius: 99,
          background: NIGHT,
          color: LIME,
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 60,
          letterSpacing: "-0.03em",
        }}
      >
        {s.button} →
      </div>
    </Ground>
  );
}

/** Every product photo the script shows, fetched once for all its pictures. */
export async function reelPhotos(script: ReelScript): Promise<Photos> {
  const urls = new Set<string>();
  for (const s of script.scenes) {
    const picks =
      s.kind === "hook" ? s.picks : s.kind === "compare" ? s.rows : s.kind === "product" ? [s.pick] : [];
    for (const p of picks) if (p.image) urls.add(p.image);
  }
  const photos: Photos = new Map();
  for (const u of urls) photos.set(u, await loadPhoto(u));
  return photos;
}

/** One picture of the Reel: scene `scene` at step `step` (a product scene has two), as JPEG. */
export async function renderReelPicture(
  script: ReelScript,
  scene: number,
  step: number,
  photos: Photos,
): Promise<Buffer> {
  const s = script.scenes[scene]!;
  const of = script.scenes.length;
  const sub = script.subcategoryId;
  const hook = script.scenes.find((x) => x.kind === "hook");
  const picks = hook?.kind === "hook" ? hook.picks : [];
  const node =
    s.kind === "hook" ? (
      <Hook s={s} at={scene} of={of} photos={photos} sub={sub} />
    ) : s.kind === "product" ? (
      step === 0 ? (
        <ProductHero s={s} at={scene} of={of} photos={photos} sub={sub} />
      ) : (
        <ProductFacts s={s} at={scene} of={of} photos={photos} sub={sub} />
      )
    ) : s.kind === "compare" ? (
      <Compare s={s} at={scene} of={of} photos={photos} sub={sub} />
    ) : (
      <Cta s={s} at={scene} of={of} photos={photos} picks={picks} sub={sub} />
    );
  const res = new ImageResponse(node, { ...STORY_SIZE, fonts: await brandFonts() });
  const png = Buffer.from(await res.arrayBuffer());
  const sharp = (await import("sharp")).default;
  return sharp(png).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}
