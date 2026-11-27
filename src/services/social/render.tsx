import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { SAMPLE_PATH } from "@/domain/catalog/media";
import type { PhoneScreen, PostCard, SocialTheme } from "@/domain/social/captions";
import { TAGLINE } from "@/domain/social/captions";
import { brandFonts, Drawing, LogoMark, Wordmark } from "@/services/ads/creatives";

// The post image (docs/SOCIAL_PLAN.md §3, §12): 1080×1350 (4:5), the widest
// Meta's publishing API accepts, on the brand's night green with lime. A
// small design system, the same on every slide: one idea per slide, a
// large headline, one hero (a numeral, a price, a phone, an illustration),
// a slide counter and a swipe cue, the site's own buttons. A product slide
// shows the shop's photo of the product on a white card (feed photos are
// shot on white); without a photo, the category drawing stands in.

export const POST_SIZE = { width: 1080, height: 1350 } as const;
/**
 * A Facebook link carousel shows square cards. The slide is laid out on a
 * 1350 × 1350 canvas (the portrait's height, so every layout keeps its
 * vertical rhythm, only wider) and scaled to 1080 × 1080.
 */
export const SQUARE_CANVAS = 1350;
export const SQUARE_SIZE = 1080;
/** A link post's preview (Open Graph, 1.91:1): laid out on 1600 × 840 and scaled to 1200 × 630. */
export const LINK_CANVAS = { width: 1600, height: 840 } as const;
export const LINK_SIZE = { width: 1200, height: 630 } as const;
/**
 * Stories and Reels (9:16, 1080 × 1920): Meta covers the top ~14 % and the
 * bottom ~20–35 % with its own interface, so the slide keeps the portrait
 * layout inside those margins and the brand ground fills the rest.
 */
export const STORY_SIZE = { width: 1080, height: 1920 } as const;
const STORY_INSETS = { top: 290, bottom: 470 } as const;
export type Shape = "portrait" | "square" | "link" | "story";

const NIGHT = "#0F2A2E";
const NIGHT_DEEP = "#0A1F22";
const NIGHT_SOFT = "#163A3F";
const LIME = "#D8F45A";
const MIST = "#F2F5F2";
const STONE = "#A9BDB9";
const MUTED = "#4E605C";
const RULE = "rgba(242,245,242,0.14)";
const PAD = 84;
const HEAD = "Space Grotesk";

const bg = `linear-gradient(165deg, ${NIGHT_SOFT} 0%, ${NIGHT} 42%, ${NIGHT_DEEP} 100%)`;
const PAPER = "#F2F4F1";

/**
 * The page's colours per theme (docs/SOCIAL_PLAN.md §14): night green as the posts began,
 * lime and light from the owner's banners. `accent` is what a highlight is drawn in,
 * `onAccent` the text on it.
 */
type Palette = { ground: string; ink: string; soft: string; accent: string; onAccent: string; rule: string };
const PALETTES: Record<SocialTheme, Palette> = {
  night: { ground: bg, ink: MIST, soft: STONE, accent: LIME, onAccent: NIGHT, rule: RULE },
  lime: {
    ground: LIME,
    ink: NIGHT,
    soft: "rgba(15,42,46,0.74)",
    accent: NIGHT,
    onAccent: LIME,
    rule: "rgba(15,42,46,0.18)",
  },
  light: {
    ground: PAPER,
    ink: NIGHT,
    soft: MUTED,
    accent: NIGHT,
    onAccent: LIME,
    rule: "rgba(15,42,46,0.14)",
  },
};

/* ---------- atoms ---------- */

function Eyebrow({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        color: LIME,
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: "0.14em",
      }}
    >
      {text.toUpperCase()}
    </div>
  );
}

function headlineSize(text: string, accent?: string): number {
  const n = Math.max(text.length, accent?.length ?? 0);
  if (n <= 14) return 132;
  if (n <= 22) return 112;
  if (n <= 34) return 92;
  if (n <= 48) return 76;
  if (n <= 70) return 64;
  return 54;
}

function Headline({ text, accent, size }: { text: string; accent?: string; size?: number }) {
  const fs = size ?? headlineSize(text, accent);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: fs,
          lineHeight: 1.02,
          letterSpacing: "-0.025em",
          color: MIST,
        }}
      >
        {text}
      </div>
      {accent ? (
        <div
          style={{
            display: "flex",
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: fs,
            lineHeight: 1.02,
            letterSpacing: "-0.025em",
            color: LIME,
          }}
        >
          {accent}
        </div>
      ) : null}
    </div>
  );
}

function Sub({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", fontSize: 34, lineHeight: 1.35, color: STONE, maxWidth: 880 }}>{text}</div>
  );
}

/** A giant lime numeral: the hero of a rank slide. */
function Numeral({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: 300,
        lineHeight: 0.85,
        letterSpacing: "-0.06em",
        color: LIME,
      }}
    >
      {text}
    </div>
  );
}

/** The one figure of a slide, with its label above it. */
function Stat({
  label,
  value,
  size = 150,
  color = MIST,
}: {
  label: string;
  value: string;
  size?: number;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", fontSize: 28, color: STONE, letterSpacing: "0.02em" }}>{label}</div>
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 0.95,
          letterSpacing: "-0.04em",
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Typographic rows with a lime numeral, no boxes. */
function Rows({ rows, compact }: { rows: { n: string; label: string; side?: string }[]; compact: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => (
        <div
          key={r.n + r.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            padding: compact ? "22px 0" : "32px 0",
            ...(i === 0 ? { borderTop: `2px solid ${RULE}` } : {}),
            borderBottom: `2px solid ${RULE}`,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 96,
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: compact ? 40 : 44,
              color: LIME,
            }}
          >
            {r.n}
          </div>
          <div
            style={{
              display: "flex",
              flex: 1,
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: compact ? 36 : 44,
              lineHeight: 1.1,
              color: MIST,
            }}
          >
            {r.label}
          </div>
          {r.side ? (
            <div
              style={{
                display: "flex",
                fontFamily: HEAD,
                fontWeight: 700,
                fontSize: compact ? 36 : 44,
                color: MIST,
              }}
            >
              {r.side}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The category drawing on a lime disc: the hero of a category slide. */
function Hero({ subcategoryId, size }: { subcategoryId: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        background: LIME,
        flexShrink: 0,
      }}
    >
      <Drawing subcategoryId={subcategoryId} size={size * 0.58} />
    </div>
  );
}

/** The product's photo on a white card: the hero of a product slide. */
function Photo({
  src,
  width,
  height,
  radius = 40,
}: {
  src: string;
  width: number;
  height: number;
  radius?: number;
}) {
  const inset = Math.round(Math.min(width, height) * 0.08);
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
        boxShadow: "0 30px 70px rgba(0,0,0,0.35)",
        flexShrink: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- satori draws it into the JPEG; nothing reaches a browser */}
      <img
        src={src}
        alt=""
        width={width - 2 * inset}
        height={height - 2 * inset}
        style={{ width: width - 2 * inset, height: height - 2 * inset, objectFit: "contain" }}
      />
    </div>
  );
}

/**
 * The photo as a data URL for the renderer: fetched from the shop's host
 * (or read from public/sample for the design samples), fitted and
 * flattened on white. Undefined when it cannot be had, so the drawing is
 * shown instead and the post still goes out.
 */
export async function loadPhoto(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    let bytes: Buffer;
    if (SAMPLE_PATH.test(url)) bytes = await readFile(path.join(process.cwd(), "public", url));
    else {
      const u = new URL(url);
      if (u.protocol !== "https:") return undefined;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "image/*" } });
      if (!res.ok) return undefined;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    const sharp = (await import("sharp")).default;
    const png = await sharp(bytes)
      .resize(900, 900, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#FFFFFF" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** The site's buttons: lime primary, outlined secondary. */
function Button({ label, primary, dark = false }: { label: string; primary: boolean; dark?: boolean }) {
  // On the phone's white screen as on the site's card: the lime request first, the dark shop button second.
  const fg = dark ? (primary ? NIGHT : "#FFFFFF") : primary ? NIGHT : MIST;
  const bgc = dark ? (primary ? LIME : NIGHT) : primary ? LIME : "transparent";
  const border = primary || dark ? "none" : `3px solid ${MIST}`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: dark ? 64 : 100,
        borderRadius: dark ? 16 : 26,
        background: bgc,
        color: fg,
        border,
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: dark ? 24 : 36,
      }}
    >
      {label}
    </div>
  );
}

/** A phone with the site on its screen, as it looks. */
function Phone({ screen, photo }: { screen: PhoneScreen; photo?: string }) {
  let body: ReactNode;
  if (screen.kind === "questions") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {screen.questions.map((q, qi) => (
          <div key={q.title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                display: "flex",
                fontFamily: HEAD,
                fontWeight: 700,
                fontSize: 27,
                color: NIGHT,
                lineHeight: 1.15,
              }}
            >
              {q.title}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {q.options.map((o, oi) => {
                const on = qi === 0 && oi === 0;
                return (
                  <div
                    key={o}
                    style={{
                      display: "flex",
                      padding: "10px 20px",
                      borderRadius: 99,
                      border: `2px solid ${on ? NIGHT : "#C9D4D1"}`,
                      background: on ? NIGHT : "#FFFFFF",
                      color: on ? "#FFFFFF" : NIGHT,
                      fontSize: 22,
                      fontWeight: 600,
                    }}
                  >
                    {o}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  } else if (screen.kind === "picks") {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {screen.picks.map((p) => (
          <div
            key={p.name}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "18px 20px",
              borderRadius: 18,
              border: `2px solid ${p.best ? LIME : "#E3E9E6"}`,
              background: p.best ? "#F7FBE4" : "#FFFFFF",
            }}
          >
            {p.best ? (
              <div
                style={{
                  display: "flex",
                  alignSelf: "flex-start",
                  background: LIME,
                  color: NIGHT,
                  fontSize: 17,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 99,
                }}
              >
                Labākā izvēle
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div
                  style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 24, color: NIGHT }}
                >
                  {p.name}
                </div>
                <div style={{ display: "flex", fontSize: 19, color: MUTED }}>{p.shop}</div>
              </div>
              <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 26, color: NIGHT }}>
                {p.price}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {photo ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 210,
              borderRadius: 18,
              background: "#F2F5F2",
              padding: 12,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- satori draws it into the JPEG; nothing reaches a browser */}
            <img
              src={photo}
              alt=""
              width={396}
              height={186}
              style={{ width: 396, height: 186, objectFit: "contain" }}
            />
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 28,
            color: NIGHT,
            lineHeight: 1.15,
          }}
        >
          {screen.name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 44, color: NIGHT }}>
            {screen.price}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: MUTED }}>{screen.shop}</div>
        </div>
        {screen.buttons.map((b, i) => (
          <Button key={b} label={b} primary={i === 0} dark />
        ))}
        {screen.strip ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 16px",
              borderRadius: 14,
              background: LIME,
              color: NIGHT,
            }}
          >
            <div
              style={{
                display: "flex",
                fontFamily: HEAD,
                fontWeight: 700,
                fontSize: 32,
                letterSpacing: "-0.02em",
              }}
            >
              {screen.strip.upTo}
            </div>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 16, lineHeight: 1.25 }}>
              <div style={{ display: "flex" }}>šai precei tas ir līdz</div>
              <div style={{ display: "flex", gap: 5 }}>
                <div style={{ display: "flex", fontWeight: 800 }}>{screen.strip.saving}</div>
                <div style={{ display: "flex" }}>lētāk</div>
              </div>
            </div>
          </div>
        ) : null}
        <div style={{ display: "flex", fontSize: 18, color: MUTED, lineHeight: 1.35 }}>{screen.note}</div>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        width: 500,
        height: 720,
        borderRadius: 60,
        background: "#0B1D20",
        padding: 14,
        boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          borderRadius: 50,
          background: "#FFFFFF",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 14 }}>
          <div style={{ display: "flex", width: 120, height: 28, borderRadius: 14, background: "#0B1D20" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 26px 8px" }}>
          <LogoMark size={28} />
          <div
            style={{
              display: "flex",
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: 22,
              color: NIGHT,
              letterSpacing: "-0.04em",
            }}
          >
            trilio
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "10px 26px 26px", flex: 1 }}>
          {body}
        </div>
      </div>
    </div>
  );
}

/* ---------- frame ---------- */

function Frame({
  children,
  index,
  total,
  cue,
  insets,
  theme = "night",
}: {
  children: ReactNode;
  index: number;
  total: number;
  cue?: string;
  theme?: SocialTheme;
  /** Extra top and bottom space (Stories and Reels interface). */
  insets?: { top: number; bottom: number };
}) {
  const carousel = total > 1;
  const pal = PALETTES[theme];
  const night = theme === "night";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: pal.ground,
        color: pal.ink,
        fontFamily: "Figtree",
        padding: insets
          ? `${insets.top}px ${PAD}px ${insets.bottom}px`
          : `${PAD - 12}px ${PAD}px ${PAD - 16}px`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* depth: a soft lime glow low right and a thin ring, both behind the content */}
      {night ? (
        <div
          style={{
            position: "absolute",
            right: -420,
            bottom: -520,
            width: 1100,
            height: 1100,
            borderRadius: 550,
            background: "radial-gradient(circle, rgba(216,244,90,0.14) 0%, rgba(216,244,90,0) 62%)",
          }}
        />
      ) : null}
      {night ? (
        <div
          style={{
            position: "absolute",
            right: -260,
            top: -300,
            width: 760,
            height: 760,
            borderRadius: 380,
            border: "2px solid rgba(216,244,90,0.14)",
          }}
        />
      ) : null}
      {/* the light page: a lime sheet and a night-green disc behind the photos, as on the collage banner */}
      {theme === "light" ? (
        <div
          style={{
            position: "absolute",
            right: -180,
            bottom: 150,
            width: 900,
            height: 640,
            borderRadius: 60,
            background: LIME,
            transform: "rotate(8deg)",
          }}
        />
      ) : null}
      {theme === "light" ? (
        <div
          style={{
            position: "absolute",
            left: -190,
            bottom: 60,
            width: 430,
            height: 430,
            borderRadius: 215,
            background: NIGHT,
          }}
        />
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark u={1.35} />
        {carousel ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {Array.from({ length: total }, (_, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  width: i === index ? 34 : 12,
                  height: 12,
                  borderRadius: 6,
                  background: i === index ? pal.accent : pal.rule,
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingTop: 56 }}>{children}</div>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingTop: 28 }}
      >
        <div style={{ display: "flex", fontSize: 28, color: pal.soft }}>
          {cue ?? (carousel && index < total - 1 ? "Ritini tālāk  →" : "")}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 34,
            color: pal.accent,
            letterSpacing: "-0.02em",
          }}
        >
          trilio.lv
        </div>
      </div>
    </div>
  );
}

/* ---------- layouts ---------- */

function Cover(c: PostCard) {
  const rows = c.rows ?? c.lines.map((l, i) => ({ n: `0${i + 1}`, label: l.main, side: l.side }));
  const hasHero = !!c.hero;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, flex: 1 }}>
          {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
          <Headline
            text={c.headline ?? c.title}
            accent={c.headlineAccent}
            size={hasHero ? Math.min(headlineSize(c.headline ?? c.title, c.headlineAccent), 92) : undefined}
          />
          {c.sub ? <Sub text={c.sub} /> : null}
        </div>
        {hasHero ? <Hero subcategoryId={c.hero!} size={260} /> : null}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <Rows rows={rows} compact={rows.length > 3} />
    </div>
  );
}

function Rank(c: PostCard) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 20 }}>
        <Numeral text={c.numeral ?? "01"} />
        {c.hero ? <Hero subcategoryId={c.hero} size={340} /> : null}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        <Headline text={c.headline ?? c.title} accent={c.headlineAccent} />
        {c.stat ? <Stat label={c.stat.label} value={c.stat.value} size={120} color={LIME} /> : null}
        {c.sub ? <Sub text={c.sub} /> : null}
      </div>
    </div>
  );
}

type Slide = Omit<PostCard, "slides"> & { photo?: string; width?: number };

function PhoneSlide(c: Slide) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
        <Headline
          text={c.headline ?? c.title}
          accent={c.headlineAccent}
          size={Math.min(headlineSize(c.headline ?? c.title, c.headlineAccent), 66)}
        />
        {c.sub ? <Sub text={c.sub} /> : null}
      </div>
      <div
        style={{ display: "flex", flex: 1, alignItems: "flex-end", justifyContent: "center", paddingTop: 30 }}
      >
        {c.phone ? <Phone screen={c.phone} photo={c.photo} /> : null}
      </div>
    </div>
  );
}

function Statement(c: PostCard) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
      <div style={{ display: "flex", flex: 1, alignItems: "center", paddingTop: 30 }}>
        <Headline
          text={c.headline ?? c.title}
          accent={c.headlineAccent}
          size={Math.min(headlineSize(c.headline ?? c.title), 84)}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <Sub text={c.sub ?? "Daži jautājumi, un trīs piemērotākie varianti."} />
        {c.hero ? <Hero subcategoryId={c.hero} size={300} /> : null}
      </div>
    </div>
  );
}

/** The middle of a product slide: the photo across the width, or the drawing at the right. */
function ProductHero({ c, size }: { c: Slide; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        justifyContent: c.photo ? "center" : "flex-end",
        alignItems: "center",
        padding: "28px 0",
      }}
    >
      {c.photo ? (
        <Photo
          src={c.photo}
          width={Math.min(c.width ?? POST_SIZE.width, POST_SIZE.width) - 2 * PAD}
          height={size}
        />
      ) : c.hero ? (
        <Hero subcategoryId={c.hero} size={size} />
      ) : null}
    </div>
  );
}

function Drop(c: Slide) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
      <div style={{ display: "flex", paddingTop: 22 }}>
        <Headline text={c.headline ?? c.title} size={Math.min(headlineSize(c.headline ?? c.title), 76)} />
      </div>
      <ProductHero c={c} size={c.photo ? 400 : 300} />
      <div style={{ display: "flex", flexDirection: "column", gap: c.photo ? 32 : 44 }}>
        {c.stat ? (
          <Stat label={c.stat.label} value={c.stat.value} size={c.photo ? 150 : 190} color={LIME} />
        ) : null}
        {c.stat2 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div
              style={{
                display: "flex",
                width: 56,
                height: 56,
                borderRadius: 28,
                background: "rgba(216,244,90,0.14)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke={LIME}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 4v16M6 14l6 6 6-6" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 26, color: STONE }}>{c.stat2.label}</div>
              <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 48, color: MIST }}>
                {c.stat2.value}
              </div>
            </div>
          </div>
        ) : null}
        {c.sub ? <Sub text={c.sub} /> : null}
      </div>
    </div>
  );
}

function Product(c: Slide) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
          {c.numeral ? <Numeral text={c.numeral} /> : null}
        </div>
        {c.photo ? (
          <Photo src={c.photo} width={400} height={400} />
        ) : c.hero ? (
          <Hero subcategoryId={c.hero} size={260} />
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        <Headline text={c.headline ?? c.title} size={Math.min(headlineSize(c.headline ?? c.title), 80)} />
        {c.stat ? <Stat label={c.stat.label} value={c.stat.value} size={120} color={LIME} /> : null}
        {c.buttons?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 6 }}>
            {c.buttons.map((b, i) => (
              <Button key={b} label={b} primary={i === 0} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Offer(c: Slide) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
      <div style={{ display: "flex", paddingTop: 22 }}>
        <Headline text={c.headline ?? c.title} size={Math.min(headlineSize(c.headline ?? c.title), 76)} />
      </div>
      <ProductHero c={c} size={c.photo ? 420 : 300} />
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 60 }}>
          {c.stat ? (
            <Stat label={c.stat.label} value={c.stat.value} size={c.photo ? 140 : 160} color={LIME} />
          ) : null}
          {c.stat2 ? <Stat label={c.stat2.label} value={c.stat2.value} size={72} color={STONE} /> : null}
        </div>
        {c.sub ? <Sub text={c.sub} /> : null}
      </div>
    </div>
  );
}

function Closing(c: PostCard) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {c.icons?.length ? (
          <div style={{ display: "flex", gap: 18, paddingBottom: 18 }}>
            {c.icons.slice(0, 4).map((id) => (
              <Hero key={id} subcategoryId={id} size={140} />
            ))}
          </div>
        ) : null}
        <Headline text={c.headline ?? c.title} accent={c.headlineAccent} />
        {c.sub ? <Sub text={c.sub} /> : null}
        {c.buttons?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 20 }}>
            <Button label={c.buttons[0]!} primary />
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
    </div>
  );
}

/** A link post's preview: the slide's words on the left, its photo or drawing on the right. */
function LinkCard(c: Slide) {
  const headline = c.headline ?? c.title;
  const long = headline.length > 40;
  return (
    <div style={{ display: "flex", flex: 1, gap: 56, alignItems: "stretch" }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 18 }}>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
        <Headline
          text={headline}
          accent={c.headlineAccent}
          size={Math.min(headlineSize(headline, c.headlineAccent), long ? 60 : 84)}
        />
        <div style={{ display: "flex", flex: 1 }} />
        {c.stat ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 48 }}>
            <Stat label={c.stat.label} value={c.stat.value} size={110} color={LIME} />
            {c.stat2 ? <Stat label={c.stat2.label} value={c.stat2.value} size={56} color={STONE} /> : null}
          </div>
        ) : c.rows?.length ? (
          <Rows rows={c.rows.slice(0, 3)} compact />
        ) : (
          <Sub text={c.sub ?? "Daži jautājumi, un trīs piemērotākie varianti."} />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {c.photo ? (
          <Photo src={c.photo} width={440} height={440} />
        ) : c.hero ? (
          <Hero subcategoryId={c.hero} size={380} />
        ) : null}
      </div>
    </div>
  );
}

/** The layout before this redesign, for a card stored without one. */
function Legacy(c: PostCard) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.eyebrow || c.chip ? <Eyebrow text={c.eyebrow ?? c.chip} /> : null}
      <div style={{ display: "flex", paddingTop: 22 }}>
        <Headline
          text={c.headline ?? c.title}
          accent={c.headlineAccent}
          size={Math.min(headlineSize(c.title), 84)}
        />
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <Rows
        rows={c.lines.map((l, i) => ({
          n: `0${i + 1}`,
          label: l.main.replace(/^\d+\.\s+/, ""),
          side: l.side,
        }))}
        compact={c.lines.length > 3}
      />
      {c.note ? (
        <div style={{ display: "flex", paddingTop: 22, fontSize: 26, color: STONE }}>{c.note}</div>
      ) : null}
    </div>
  );
}

/* ---------- themed designs (docs/SOCIAL_PLAN.md §14) ---------- */

type Themed = Slide & { photos?: string[]; cover?: string };

function Tag({ text, pal }: { text: string; pal: Palette }) {
  return (
    <div style={{ display: "flex" }}>
      <div
        style={{
          display: "flex",
          background: pal.accent,
          color: pal.onAccent,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "10px 18px",
          borderRadius: 10,
          transform: "rotate(-2deg)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** One figure as large as the page allows ("−50 €"), what it means, and the product it is about. */
function Big(c: Themed) {
  const pal = PALETTES[c.theme ?? "lime"];
  const figure = c.numeral ?? "";
  const size = figure.length <= 6 ? 250 : figure.length <= 8 ? 200 : 160;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.eyebrow ? <Tag text={c.eyebrow} pal={pal} /> : null}
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 0.95,
          letterSpacing: "-0.05em",
          color: pal.ink,
          paddingTop: 26,
          whiteSpace: "nowrap",
        }}
      >
        {figure}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 600,
          fontSize: 62,
          lineHeight: 1.04,
          letterSpacing: "-0.03em",
          color: pal.ink,
          paddingTop: 14,
        }}
      >
        {c.headline ?? c.title}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 36,
          background: NIGHT,
          color: MIST,
          borderRadius: 36,
          padding: 34,
          transform: "rotate(-1.5deg)",
          boxShadow: "0 30px 60px rgba(15,42,46,0.28)",
        }}
      >
        {c.photo ? (
          <Photo src={c.photo} width={250} height={250} radius={26} />
        ) : c.hero ? (
          <Hero subcategoryId={c.hero} size={220} />
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
          {c.sub ? (
            <div
              style={{ display: "flex", fontFamily: HEAD, fontWeight: 600, fontSize: 38, lineHeight: 1.1 }}
            >
              {c.sub.length > 44 ? `${c.sub.slice(0, 43)}…` : c.sub}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 40, alignItems: "flex-end" }}>
            {c.stat ? <Stat label={c.stat.label} value={c.stat.value} size={62} color={LIME} /> : null}
            {c.stat2 ? <Stat label={c.stat2.label} value={c.stat2.value} size={44} color={STONE} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The products' own photos scattered on the page, each on its white card, with the names below. */
function Collage(c: Themed) {
  const pal = PALETTES[c.theme ?? "light"];
  const photos = c.photos ?? [];
  // Where each card sits and how it leans: a tall one at the left, the rest stepping right.
  const spots = [
    { left: 0, top: 24, w: 260, h: 400, r: -6 },
    { left: 270, top: 0, w: 250, h: 260, r: 5 },
    { left: 520, top: 150, w: 270, h: 290, r: 9 },
    { left: 270, top: 250, w: 220, h: 220, r: -4 },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {c.eyebrow ? <Tag text={c.eyebrow} pal={pal} /> : null}
        <div
          style={{
            display: "flex",
            fontFamily: HEAD,
            fontWeight: 600,
            fontSize: (c.headline ?? c.title).length > 20 ? 68 : 96,
            lineHeight: 1.0,
            letterSpacing: "-0.035em",
            color: pal.ink,
          }}
        >
          {c.headline ?? c.title}
        </div>
        {c.sub ? <div style={{ display: "flex", fontSize: 32, color: pal.soft }}>{c.sub}</div> : null}
      </div>
      <div style={{ display: "flex", position: "relative", height: 480, marginTop: 22 }}>
        {photos.slice(0, 4).map((src, i) => {
          const s = spots[i]!;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                position: "absolute",
                left: s.left,
                top: s.top,
                transform: `rotate(${s.r}deg)`,
              }}
            >
              <Photo src={src} width={s.w} height={s.h} radius={30} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: NIGHT,
          color: MIST,
          borderRadius: 30,
          padding: "10px 30px",
        }}
      >
        {(c.rows ?? []).slice(0, 3).map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "14px 0",
              borderTop: i ? `1px solid ${RULE}` : "none",
            }}
          >
            <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 30, color: LIME }}>
              {r.n}
            </div>
            <div style={{ display: "flex", flex: 1, fontSize: 32, fontWeight: 600 }}>
              {r.label.length > 30 ? `${r.label.slice(0, 29)}…` : r.label}
            </div>
            {r.side ? (
              <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 34 }}>{r.side}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A question in large type and its answers on a white card, lettered as the site's own choices. */
function Ask(c: Themed) {
  const pal = PALETTES[c.theme ?? "lime"];
  const q = c.headline ?? c.title;
  const options = c.options ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.eyebrow ? <Tag text={c.eyebrow} pal={pal} /> : null}
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 600,
          fontSize: q.length > 60 ? 62 : q.length > 30 ? 78 : 104,
          lineHeight: 1.03,
          letterSpacing: "-0.035em",
          color: pal.ink,
          paddingTop: 30,
        }}
      >
        {q}
      </div>
      {c.sub ? (
        <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: pal.soft, paddingTop: 22 }}>
          {c.sub}
        </div>
      ) : null}
      <div style={{ display: "flex", flex: 1 }} />
      {options.length ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            background: "#FFFFFF",
            borderRadius: 36,
            padding: 30,
            boxShadow: "0 30px 60px rgba(15,42,46,0.22)",
          }}
        >
          {options.slice(0, 4).map((o, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                borderRadius: 20,
                padding: "20px 24px",
                background: i === 0 ? NIGHT : "#FFFFFF",
                color: i === 0 ? MIST : NIGHT,
                border: i === 0 ? "none" : "2px solid rgba(15,42,46,0.16)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: i === 0 ? LIME : "rgba(15,42,46,0.08)",
                  color: NIGHT,
                  fontWeight: 800,
                  fontSize: 26,
                }}
              >
                {"ABCD"[i]}
              </div>
              <div style={{ display: "flex", flex: 1, fontSize: 34, fontWeight: 600 }}>
                {o.label.length > 28 ? `${o.label.slice(0, 27)}…` : o.label}
              </div>
              {o.side ? (
                <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 34 }}>
                  {o.side}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : c.hero ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 320,
              height: 320,
              borderRadius: 160,
              background: "#FFFFFF",
            }}
          >
            <Drawing subcategoryId={c.hero} size={190} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A photo of people at home across the top (a stock photo, never a customer), the sentence below it. */
function People(c: Themed) {
  const pal = PALETTES.night;
  const w = Math.min(c.width ?? POST_SIZE.width, POST_SIZE.width) - 2 * PAD;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {c.cover ? (
        <div style={{ display: "flex", borderRadius: 40, overflow: "hidden", height: 560 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- satori draws it into the JPEG; nothing reaches a browser */}
          <img
            src={c.cover}
            alt=""
            width={w}
            height={560}
            style={{ width: w, height: 560, objectFit: "cover" }}
          />
        </div>
      ) : c.hero ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Hero subcategoryId={c.hero} size={300} />
        </div>
      ) : null}
      <div style={{ display: "flex", paddingTop: 34 }}>
        {c.eyebrow ? <Tag text={c.eyebrow} pal={pal} /> : null}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 600,
          fontSize: (c.headline ?? c.title).length > 60 ? 54 : 68,
          lineHeight: 1.06,
          letterSpacing: "-0.03em",
          color: pal.ink,
          paddingTop: 22,
        }}
      >
        {c.headline ?? c.title}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      {c.sub ? <div style={{ display: "flex", fontSize: 32, color: pal.soft }}>{c.sub}</div> : null}
    </div>
  );
}

/**
 * A photo cropped to fill a box (people at home): fetched over https, cut to the box around its
 * middle, as a data URL. Undefined when it cannot be had; the design then falls back to the drawing.
 */
export async function loadCover(
  url: string | undefined,
  width: number,
  height: number,
): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    let bytes: Buffer;
    if (SAMPLE_PATH.test(url)) bytes = await readFile(path.join(process.cwd(), "public", url));
    else {
      if (new URL(url).protocol !== "https:") return undefined;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "image/*" } });
      if (!res.ok) return undefined;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(bytes)
      .resize(width, height, { fit: "cover", position: "attention" })
      .jpeg({ quality: 86 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * One product of the three (layout "pick"): its letter, tier and the "Labākā izvēle" pill, the
 * photo large on a light panel, the name, today's price and shop, the key specs, and what it
 * gives (+) or does worse (−) than the cheapest, or what the cheapest saves (✓).
 */
function Pick(c: Slide) {
  const name = c.headline ?? c.title;
  // The photo takes the room the words leave: less for a two-line name and for every line past two.
  const rows = Math.min(c.rows?.length ?? 0, 4);
  const photoHeight = Math.max(
    280,
    470 - (name.length > 26 ? 64 : 0) - Math.max(0, rows - 2) * 48 - (c.sub ? 0 : -40),
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : <div />}
        {c.badge ? (
          <div
            style={{
              display: "flex",
              background: LIME,
              color: NIGHT,
              fontSize: 26,
              fontWeight: 700,
              padding: "8px 22px",
              borderRadius: 99,
            }}
          >
            {c.badge}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 300, alignItems: "center" }}>
        {c.photo ? (
          <Photo
            src={c.photo}
            width={(c.width ?? POST_SIZE.width) - 2 * PAD}
            height={photoHeight}
            radius={36}
          />
        ) : c.subcategoryId ? (
          <Hero subcategoryId={c.subcategoryId} size={300} />
        ) : null}
      </div>
      <Headline text={name} size={name.length > 26 ? 54 : 64} />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 30 }}>
        {c.stat ? <Stat label={c.stat.label} value={c.stat.value} size={96} color={LIME} /> : null}
      </div>
      {c.sub ? (
        <div style={{ display: "flex", fontSize: 28, lineHeight: 1.3, color: STONE }}>{c.sub}</div>
      ) : null}
      {c.rows?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {c.rows.slice(0, 4).map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  display: "flex",
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  background: r.n === "−" ? "rgba(242,245,242,0.12)" : LIME,
                  color: r.n === "−" ? MIST : NIGHT,
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {r.n === "✓" ? (
                  // Drawn: the brand fonts have no check mark.
                  <svg
                    width="22"
                    height="22"
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
                  r.n
                )}
              </div>
              <div style={{ display: "flex", fontSize: 30, color: MIST }}>{r.label}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const LAYOUTS = {
  big: Big,
  collage: Collage,
  ask: Ask,
  people: People,
  cover: Cover,
  rank: Rank,
  phone: PhoneSlide,
  statement: Statement,
  drop: Drop,
  product: Product,
  offer: Offer,
  closing: Closing,
  pick: Pick,
} as const;

/** One slide; `index`/`total` draw the counter and the swipe cue of a carousel. */
export async function renderPost(
  card: Omit<PostCard, "slides">,
  index = 0,
  total = 1,
  shape: Shape = "portrait",
): Promise<ImageResponse> {
  const size =
    shape === "square"
      ? { width: SQUARE_CANVAS, height: SQUARE_CANVAS }
      : shape === "link"
        ? LINK_CANVAS
        : shape === "story"
          ? STORY_SIZE
          : POST_SIZE;
  const Layout = shape === "link" ? LinkCard : card.layout ? LAYOUTS[card.layout] : Legacy;
  const people = card.layout === "people";
  const photo = people
    ? undefined
    : await loadPhoto(card.image ?? (card.phone?.kind === "card" ? card.phone.image : undefined));
  const cover = people ? await loadCover(card.image, size.width - 2 * PAD, 560) : undefined;
  const photos =
    card.layout === "collage"
      ? (await Promise.all((card.images ?? []).slice(0, 4).map((u) => loadPhoto(u)))).filter(
          (p): p is string => !!p,
        )
      : undefined;
  const themed = card.layout === "big" || card.layout === "collage" || card.layout === "ask" || people;
  const cue =
    card.layout === "cover" && total > 1
      ? "Ritini tālāk  →"
      : card.layout === "closing"
        ? TAGLINE
        : undefined;
  return new ImageResponse(
    <Frame
      index={index}
      total={total}
      cue={cue}
      insets={shape === "story" ? STORY_INSETS : undefined}
      theme={themed && shape !== "link" ? (card.theme ?? "night") : "night"}
    >
      <Layout {...card} photo={photo} photos={photos} cover={cover} width={size.width} />
    </Frame>,
    { ...size, fonts: await brandFonts() },
  );
}

/** The slides of a carousel, or the one image of any other post. */
export const slidesOf = (card: PostCard): Omit<PostCard, "slides">[] =>
  card.slides?.length ? card.slides : [card];

/** Instagram takes JPEG only; Facebook takes either. */
export async function renderPostJpeg(
  card: Omit<PostCard, "slides">,
  index = 0,
  total = 1,
  shape: Shape = "portrait",
): Promise<Buffer> {
  const png = Buffer.from(await (await renderPost(card, index, total, shape)).arrayBuffer());
  const sharp = (await import("sharp")).default;
  const img =
    shape === "square"
      ? sharp(png).resize(SQUARE_SIZE, SQUARE_SIZE)
      : shape === "link"
        ? sharp(png).resize(LINK_SIZE.width, LINK_SIZE.height)
        : sharp(png);
  return img.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
