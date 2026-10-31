import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { SAMPLE_PATH } from "@/domain/catalog/media";
import type { PhoneScreen, PostCard } from "@/domain/social/captions";
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
  const fg = dark ? (primary ? "#FFFFFF" : NIGHT) : primary ? NIGHT : MIST;
  const bgc = dark ? (primary ? NIGHT : "#FFFFFF") : primary ? LIME : "transparent";
  const border = primary ? "none" : `3px solid ${dark ? NIGHT : MIST}`;
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
        {screen.picks.map((p, i) => (
          <div
            key={p.name}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "18px 20px",
              borderRadius: 18,
              border: `2px solid ${i === 1 ? LIME : "#E3E9E6"}`,
              background: i === 1 ? "#F7FBE4" : "#FFFFFF",
            }}
          >
            {i === 1 ? (
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
              height: 170,
              borderRadius: 18,
              background: "#F2F5F2",
              padding: 12,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- satori draws it into the JPEG; nothing reaches a browser */}
            <img
              src={photo}
              alt=""
              width={300}
              height={146}
              style={{ width: 300, height: 146, objectFit: "contain" }}
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
}: {
  children: ReactNode;
  index: number;
  total: number;
  cue?: string;
}) {
  const carousel = total > 1;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: bg,
        color: MIST,
        fontFamily: "Figtree",
        padding: `${PAD - 12}px ${PAD}px ${PAD - 16}px`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* depth: a soft lime glow low right and a thin ring, both behind the content */}
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
                  background: i === index ? LIME : "rgba(242,245,242,0.32)",
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
        <div style={{ display: "flex", fontSize: 28, color: STONE }}>
          {cue ?? (carousel && index < total - 1 ? "Ritini tālāk  →" : "")}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 34,
            color: LIME,
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

type Slide = Omit<PostCard, "slides"> & { photo?: string };

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
        <Sub text="Daži jautājumi, un trīs piemērotākie varianti." />
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
        <Photo src={c.photo} width={POST_SIZE.width - 2 * PAD} height={size} />
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
        rows={c.lines.map((l, i) => ({ n: `0${i + 1}`, label: l.main, side: l.side }))}
        compact={c.lines.length > 3}
      />
      {c.note ? (
        <div style={{ display: "flex", paddingTop: 22, fontSize: 26, color: STONE }}>{c.note}</div>
      ) : null}
    </div>
  );
}

const LAYOUTS = {
  cover: Cover,
  rank: Rank,
  phone: PhoneSlide,
  statement: Statement,
  drop: Drop,
  product: Product,
  offer: Offer,
  closing: Closing,
} as const;

/** One slide; `index`/`total` draw the counter and the swipe cue of a carousel. */
export async function renderPost(
  card: Omit<PostCard, "slides">,
  index = 0,
  total = 1,
): Promise<ImageResponse> {
  const Layout = card.layout ? LAYOUTS[card.layout] : Legacy;
  const photo = await loadPhoto(card.image ?? (card.phone?.kind === "card" ? card.phone.image : undefined));
  const cue =
    card.layout === "cover" && total > 1
      ? "Ritini tālāk  →"
      : card.layout === "closing"
        ? TAGLINE
        : undefined;
  return new ImageResponse(
    <Frame index={index} total={total} cue={cue}>
      <Layout {...card} photo={photo} />
    </Frame>,
    { ...POST_SIZE, fonts: await brandFonts() },
  );
}

/** The slides of a carousel, or the one image of any other post. */
export const slidesOf = (card: PostCard): Omit<PostCard, "slides">[] =>
  card.slides?.length ? card.slides : [card];

/** Instagram takes JPEG only; Facebook takes either. */
export async function renderPostJpeg(card: Omit<PostCard, "slides">, index = 0, total = 1): Promise<Buffer> {
  const png = Buffer.from(await (await renderPost(card, index, total)).arrayBuffer());
  const sharp = (await import("sharp")).default;
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
