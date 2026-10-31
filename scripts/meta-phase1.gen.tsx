import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import sharp from "sharp";
import { it } from "vitest";
import { brandFonts, Wordmark } from "@/services/ads/creatives";

// Meta Phase 1 ads (docs/META_ADS_PHASE1.md). Product-led and designed, not
// screenshots: the site's own elements (a question, the recommendation card,
// the two buttons) are drawn here at poster scale with real data from
// trilio.lv/rezultati?sub=washer on 1 Nov 2026 (three picks for 3–4 people,
// front loading, 300–700 €) and the shops' product photos. Every picture
// with a price carries the date. Run: npm run creatives:meta.

const SRC = path.join(process.cwd(), "assets/ads/meta-phase1-src");
const OUT = path.join(process.cwd(), "assets/ads/meta-phase1");
const DATED = "Cenas partneru veikalos 1.11.2026. Cenas mainās.";

const NIGHT = "#0F2A2E";
const NIGHT_DEEP = "#0A1F22";
const NIGHT_SOFT = "#163A3F";
const LIME = "#D8F45A";
const MIST = "#F2F5F2";
const STONE = "#A9BDB9";
const MUTED = "#5B6E6A";
const LINE = "#DCE4E1";
const HEAD = "Space Grotesk";

type Shape = "feed" | "story" | "square";
type Z = {
  w: number;
  h: number;
  top: number;
  bottom: number;
  side: number;
  head: number;
  /** Scale of the drawn site elements. */
  k: number;
  /** One tile: its width and photo height; three tiles: their photo height and scale. */
  one: number;
  oneP: number;
  threeP: number;
  threeK: number;
};
const SIZE: Record<Shape, Z> = {
  feed: {
    w: 1080,
    h: 1350,
    top: 64,
    bottom: 60,
    side: 72,
    head: 92,
    k: 1,
    one: 660,
    oneP: 300,
    threeP: 250,
    threeK: 0.9,
  },
  story: {
    w: 1080,
    h: 1920,
    top: 280,
    bottom: 480,
    side: 72,
    head: 96,
    k: 1.04,
    one: 680,
    oneP: 320,
    threeP: 260,
    threeK: 0.92,
  },
  square: {
    w: 1080,
    h: 1080,
    top: 56,
    bottom: 52,
    side: 64,
    head: 74,
    k: 0.86,
    one: 580,
    oneP: 220,
    threeP: 185,
    threeK: 0.74,
  },
};

type Product = {
  name: string;
  model: string;
  price: string;
  shop: string;
  label?: string;
  reason: string;
  photo: string;
};

/** The three picks as the site showed them (brand + model code; the site's own label and reason). */
const PICKS: Product[] = [
  {
    name: "Gorenje W11NHPI84AS",
    model: "W11NHPI84AS",
    price: "324 €",
    shop: "Tet",
    label: "Lētākais, ko paši pirktu",
    reason: "3–4 cilvēkiem 8 kg ir īstā ietilpība. Lētākais variants, kas iztur mūsu kvalitātes minimumu.",
    photo: "product-1",
  },
  {
    name: "LG F4X1009NWB",
    model: "F4X1009NWB",
    price: "360 €",
    shop: "Tet",
    label: "+1 kg, uzticamāks zīmols",
    reason: "9 kg ietilpība un uzticamāks zīmols šajā kategorijā. Par 36 € vairāk nekā lētākais.",
    photo: "product-2",
  },
  {
    name: "LG F4X5011TWB",
    model: "F4X5011TWB",
    price: "432 €",
    shop: "Tet",
    label: "Saprātīgā izvēle",
    reason: "11 kg: ietilpīgākais no šiem. Par ~90 € mazāk elektrībai 10 gados.",
    photo: "product-3",
  },
];

const CRITERIA = ["3–4 cilvēki", "Priekšējā ielāde", "300–700 €"];

type Photos = Record<string, string>;

async function photo(name: string): Promise<string> {
  // Shops leave wide white margins around the product; trimmed, so every tile shows the machine at the same scale.
  const buf = await sharp(path.join(SRC, `${name}.webp`))
    .flatten({ background: "#FFFFFF" })
    .trim({ threshold: 12 })
    .resize(900, 900, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/* ---------- ground and type ---------- */

function Ground({ z, children }: { z: Z; children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(172deg, ${NIGHT_SOFT} 0%, ${NIGHT} 48%, ${NIGHT_DEEP} 100%)`,
        color: MIST,
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
          background: "radial-gradient(circle, rgba(216,244,90,0.13) 0%, rgba(216,244,90,0) 62%)",
        }}
      />
      {children}
    </div>
  );
}

function Top({ kicker }: { kicker: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Wordmark u={1.1} />
      <div style={{ display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: "0.14em", color: LIME }}>
        {kicker.toUpperCase()}
      </div>
    </div>
  );
}

function Headline({ z, lines, accent }: { z: Z; lines: string[]; accent?: string }) {
  const line = (t: string, color: string) => (
    <div
      key={t}
      style={{
        display: "flex",
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: z.head,
        lineHeight: 1.02,
        letterSpacing: "-0.03em",
        color,
      }}
    >
      {t}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 34 }}>
      {lines.map((l) => line(l, MIST))}
      {accent ? line(accent, LIME) : null}
    </div>
  );
}

function Foot({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 30 }}>
      <div style={{ display: "flex", fontSize: 22, color: STONE, maxWidth: 760, lineHeight: 1.3 }}>
        {text}
      </div>
      <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 30, color: LIME }}>
        trilio.lv
      </div>
    </div>
  );
}

const Spacer = () => <div style={{ display: "flex", flex: 1 }} />;

/* ---------- the site's elements, drawn at poster scale ---------- */

function Chip({ text, k = 1 }: { text: string; k?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        padding: `${8 * k}px ${16 * k}px`,
        borderRadius: 999,
        background: "#EAF5C8",
        color: NIGHT,
        fontSize: 19 * k,
        fontWeight: 700,
      }}
    >
      {text}
    </div>
  );
}

function Button({ text, kind, k = 1 }: { text: string; kind: "dark" | "lime"; k?: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        gap: 12 * k,
        height: 66 * k,
        borderRadius: 999,
        background: kind === "dark" ? NIGHT : LIME,
        color: kind === "dark" ? "#FFFFFF" : NIGHT,
        fontSize: 25 * k,
        fontWeight: 700,
        boxShadow: kind === "lime" ? "0 14px 34px rgba(216,244,90,0.35)" : "none",
      }}
    >
      {kind === "lime" ? (
        <svg
          width={26 * k}
          height={26 * k}
          viewBox="0 0 24 24"
          fill="none"
          stroke={NIGHT}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
          <circle cx="7.5" cy="7.5" r="1.2" fill={NIGHT} />
        </svg>
      ) : null}
      {text}
    </div>
  );
}

/**
 * A recommendation as the site shows it: the label, the photo, the name,
 * the price and the shop; optionally the reason line and the two buttons.
 */
function Tile({
  p,
  photos,
  width,
  photoH,
  k = 1,
  reason = false,
  buttons = false,
  priceSize = 40,
}: {
  p: Product;
  photos: Photos;
  width: number;
  photoH: number;
  k?: number;
  reason?: boolean;
  buttons?: boolean;
  priceSize?: number;
}) {
  const pad = 26 * k;
  const iw = width - 2 * pad;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        padding: pad,
        gap: 14 * k,
        borderRadius: 34 * k,
        background: "#FFFFFF",
        boxShadow: "0 34px 80px rgba(0,0,0,0.5)",
      }}
    >
      {p.label ? <Chip text={p.label} k={k} /> : null}
      <div
        style={{ display: "flex", justifyContent: "center", alignItems: "center", width: iw, height: photoH }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori draws it into the image */}
        <img
          src={photos[p.photo]}
          alt=""
          width={iw}
          height={photoH}
          style={{ width: iw, height: photoH, objectFit: "contain" }}
        />
      </div>
      {reason ? (
        <div style={{ display: "flex", fontSize: 23 * k, lineHeight: 1.35, color: NIGHT }}>{p.reason}</div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 * k }}>
        <div
          style={{
            display: "flex",
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 27 * k,
            color: NIGHT,
            lineHeight: 1.1,
          }}
        >
          {p.name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 * k }}>
          <div
            style={{
              display: "flex",
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: priceSize * k,
              color: NIGHT,
              letterSpacing: "-0.02em",
            }}
          >
            {p.price}
          </div>
          <div style={{ display: "flex", fontSize: 21 * k, color: MUTED }}>{p.shop}</div>
        </div>
      </div>
      {buttons ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 * k, paddingTop: 8 * k }}>
          <Button text={`Pirkt — ${p.shop}`} kind="dark" k={k} />
          <Button text="Pieprasīt labāku cenu" kind="lime" k={k} />
        </div>
      ) : null}
    </div>
  );
}

/** The first question of the washer flow, as the site asks it. */
function Question({ width, k = 1 }: { width: number; k?: number }) {
  const opts: [string, string, boolean][] = [
    ["Priekšējā ielāde", "visizplatītākā", true],
    ["Augšējā ielāde", "šaura, ~40 cm plata", false],
    ["Ar žāvētāju", "mazgā un žāvē vienā", false],
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        padding: 30 * k,
        gap: 16 * k,
        borderRadius: 34 * k,
        background: "#FFFFFF",
        boxShadow: "0 34px 80px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{ display: "flex", fontSize: 19 * k, fontWeight: 700, letterSpacing: "0.1em", color: MUTED }}
      >
        JAUTĀJUMS 1 NO 3
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 34 * k,
          lineHeight: 1.1,
          color: NIGHT,
        }}
      >
        Kāda veļas mašīna tev vajadzīga?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 * k, paddingTop: 6 * k }}>
        {opts.map(([t, s, on]) => (
          <div
            key={t}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16 * k,
              padding: `${16 * k}px ${20 * k}px`,
              borderRadius: 18 * k,
              background: on ? NIGHT : "#FFFFFF",
              border: `2px solid ${on ? NIGHT : LINE}`,
              color: on ? "#FFFFFF" : NIGHT,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 22 * k,
                height: 22 * k,
                borderRadius: 999,
                border: `2px solid ${on ? LIME : "#B9C6C2"}`,
                background: on ? LIME : "transparent",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 24 * k, fontWeight: 700 }}>{t}</div>
              <div style={{ display: "flex", fontSize: 18 * k, color: on ? "#C9D6D2" : MUTED }}>{s}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", width: 170 * k, paddingTop: 6 * k }}>
        <Button text="Tālāk" kind="lime" k={k} />
      </div>
    </div>
  );
}

function Criteria({ k = 1 }: { k?: number }) {
  return (
    <div style={{ display: "flex", gap: 12 * k, flexWrap: "wrap" }}>
      {CRITERIA.map((c) => (
        <div
          key={c}
          style={{
            display: "flex",
            padding: `${11 * k}px ${22 * k}px`,
            borderRadius: 999,
            border: "2px solid rgba(216,244,90,0.7)",
            color: LIME,
            fontSize: 26 * k,
            fontWeight: 700,
          }}
        >
          {c}
        </div>
      ))}
    </div>
  );
}

/* ---------- the ads ---------- */

function Three({ z, photos }: { z: Z; photos: Photos }) {
  const gap = 18;
  const w = Math.floor((z.w - 2 * z.side - 2 * gap) / 3);
  return (
    <div style={{ display: "flex", gap, alignItems: "flex-start" }}>
      {PICKS.map((p) => (
        <Tile key={p.model} p={p} photos={photos} width={w} photoH={z.threeP} k={z.threeK} priceSize={38} />
      ))}
    </div>
  );
}

const Centre = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "center" }}>{children}</div>
);

const ADS: Record<string, (z: Z, ph: Photos) => ReactNode> = {
  "A1-tris-ieteikumi": (z, ph) => (
    <Ground z={z}>
      <Top kicker="Veļas mašīnas" />
      <Headline z={z} lines={["Daži jautājumi."]} accent="Trīs ieteikumi." />
      <div style={{ display: "flex", paddingTop: 26 }}>
        <Criteria k={0.78 * z.k} />
      </div>
      <Spacer />
      <Three z={z} photos={ph} />
      <Spacer />
      <Foot text={DATED} />
    </Ground>
  ),
  "A2-pieprasi-labaku-cenu": (z, ph) => (
    <Ground z={z}>
      <Top kicker="Pie katra ieteikuma" />
      <Headline z={z} lines={["Patīk modelis?"]} accent="Pieprasi labāku cenu." />
      <Spacer />
      <Centre>
        <Tile p={PICKS[0]!} photos={ph} width={z.one} photoH={z.oneP} k={z.k} buttons />
      </Centre>
      <Spacer />
      <Foot text="Pajautāsim izplatītājam. Ja varēsim lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena kritīs." />
    </Ground>
  ),
  "A3-dazi-jautajumi": (z) => (
    <Ground z={z}>
      <Top kicker="Veļas mašīnas" />
      <Headline z={z} lines={["Kuru izvēlēties?"]} accent="Daži jautājumi." />
      <Spacer />
      <Centre>
        <Question width={z.one} k={z.k} />
      </Centre>
      <Spacer />
      <Foot text="Tikai jautājumi, kas izšķir izvēli. Pēc tiem trīs piemērotākie modeļi." />
    </Ground>
  ),
  "A4-piemerotakais-modelis": (z, ph) => (
    <Ground z={z}>
      <Top kicker="Veļas mašīnas" />
      <Headline z={z} lines={["Piemērotākais modelis"]} accent="atbilstoši kritērijiem." />
      <div style={{ display: "flex", paddingTop: 26 }}>
        <Criteria k={0.78 * z.k} />
      </div>
      <Spacer />
      <Centre>
        <Tile p={PICKS[0]!} photos={ph} width={z.one + 40} photoH={z.oneP + 20} k={z.k} reason />
      </Centre>
      <Spacer />
      <Foot text={DATED} />
    </Ground>
  ),
};

/** The carousel: four swipes through Trilio, one idea each. */
const SQ = SIZE.square;
const CARDS: Record<
  string,
  { kicker: string; lines: string[]; accent?: string; body: (ph: Photos) => ReactNode; foot: string }
> = {
  "1-dazi-jautajumi": {
    kicker: "1 / 4",
    lines: ["Daži jautājumi."],
    body: () => (
      <Centre>
        <Question width={SQ.one} k={SQ.k} />
      </Centre>
    ),
    foot: "Tikai tie, kas izšķir izvēli.",
  },
  "2-tris-modeli": {
    kicker: "2 / 4",
    lines: ["Trīs piemērotākie modeļi."],
    body: (ph) => <Three z={SQ} photos={ph} />,
    foot: DATED,
  },
  "3-kapec-sis": {
    kicker: "3 / 4",
    lines: ["Pie katra: kāpēc tieši šis."],
    body: (ph) => (
      <Centre>
        <Tile p={PICKS[0]!} photos={ph} width={SQ.one + 40} photoH={SQ.oneP} k={SQ.k} reason />
      </Centre>
    ),
    foot: DATED,
  },
  "4-pieprasi-labaku-cenu": {
    kicker: "4 / 4",
    lines: ["Patīk?"],
    accent: "Pieprasi labāku cenu.",
    body: (ph) => (
      <Centre>
        <Tile p={PICKS[0]!} photos={ph} width={SQ.one} photoH={SQ.oneP - 40} k={SQ.k} buttons />
      </Centre>
    ),
    foot: "Ja varēsim lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena kritīs.",
  },
};

function CarouselCard({ c, ph }: { c: (typeof CARDS)[string]; ph: Photos }) {
  return (
    <Ground z={SQ}>
      <Top kicker={c.kicker} />
      <Headline z={{ ...SQ, head: 66 }} lines={c.lines} accent={c.accent} />
      <Spacer />
      {c.body(ph)}
      <Spacer />
      <Foot text={c.foot} />
    </Ground>
  );
}

/* ---------- output ---------- */

async function jpeg(node: ReactNode, w: number, h: number): Promise<Buffer> {
  const png = Buffer.from(
    await new ImageResponse(<div style={{ display: "flex", width: w, height: h }}>{node}</div>, {
      width: w,
      height: h,
      fonts: await brandFonts(),
    }).arrayBuffer(),
  );
  return sharp(png).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

/** Keyframes → H.264 with a slow push-in and short cross-fades (one still per input). */
function reel(frames: { file: string; seconds: number }[], out: string, w: number, h: number): void {
  const fade = 0.35;
  const fps = 30;
  const args: string[] = ["-y"];
  for (const f of frames) args.push("-i", f.file);
  const parts = frames.map((f, i) => {
    const n = Math.round((f.seconds + fade) * fps);
    return `[${i}:v]scale=${Math.round(w * 1.5)}:${Math.round(h * 1.5)},zoompan=z='min(zoom+0.0005,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${w}x${h}:fps=${fps},format=yuv420p,setsar=1[v${i}]`;
  });
  let last = "v0";
  let offset = 0;
  for (let i = 1; i < frames.length; i++) {
    offset += frames[i - 1]!.seconds;
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}[x${i}]`);
    last = `x${i}`;
  }
  args.push(
    "-filter_complex",
    parts.join(";"),
    "-map",
    `[${last}]`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-crf",
    "21",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-r",
    String(fps),
    out,
  );
  execFileSync("ffmpeg", args, { stdio: "ignore" });
}

const SHAPES: [Shape, string][] = [
  ["feed", "4x5_1080x1350"],
  ["story", "9x16_1080x1920"],
  ["square", "1x1_1080x1080"],
];

it("renders the Meta Phase 1 set", async () => {
  const ph: Photos = {
    "product-1": await photo("product-1"),
    "product-2": await photo("product-2"),
    "product-3": await photo("product-3"),
  };
  rmSync(OUT, { recursive: true, force: true });
  for (const [name, ad] of Object.entries(ADS)) {
    const dir = path.join(OUT, name);
    mkdirSync(dir, { recursive: true });
    for (const [shape, tag] of SHAPES) {
      const z = SIZE[shape];
      writeFileSync(path.join(dir, `${name}_${tag}.jpg`), await jpeg(ad(z, ph), z.w, z.h));
    }
  }
  const cdir = path.join(OUT, "A5-karuselis");
  mkdirSync(cdir, { recursive: true });
  for (const [name, c] of Object.entries(CARDS))
    writeFileSync(
      path.join(cdir, `A5-karte-${name}_1x1_1080x1080.jpg`),
      await jpeg(<CarouselCard c={c} ph={ph} />, 1080, 1080),
    );

  const end = (z: Z) => (
    <Ground z={z}>
      <Top kicker="Veļas mašīnas" />
      <Headline
        z={z}
        lines={["Daži jautājumi.", "Trīs ieteikumi."]}
        accent="Pērc vai pieprasi labāku cenu."
      />
      <Spacer />
      <div style={{ display: "flex", width: 320 }}>
        <Button text="Sākt izvēli" kind="lime" k={1.15} />
      </div>
      <Spacer />
      <Foot text="Padoms bez maksas, bez konta." />
    </Ground>
  );
  const R: [string, (z: Z) => ReactNode, number][] = [
    ["q", (z) => ADS["A3-dazi-jautajumi"]!(z, ph), 2.8],
    ["three", (z) => ADS["A1-tris-ieteikumi"]!(z, ph), 3.2],
    ["fit", (z) => ADS["A4-piemerotakais-modelis"]!(z, ph), 3.2],
    ["ask", (z) => ADS["A2-pieprasi-labaku-cenu"]!(z, ph), 3.4],
    ["end", end, 2.6],
  ];
  const rdir = path.join(OUT, "R1-ka-tas-strada");
  const tmp = path.join(OUT, ".frames");
  mkdirSync(rdir, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  for (const [shape, tag] of [
    ["story", "9x16_1080x1920"],
    ["feed", "4x5_1080x1350"],
  ] as const) {
    const z = SIZE[shape];
    const files: { file: string; seconds: number }[] = [];
    for (const [key, f, seconds] of R) {
      const file = path.join(tmp, `${shape}-${key}.jpg`);
      writeFileSync(file, await jpeg(f(z), z.w, z.h));
      files.push({ file, seconds });
    }
    reel(files, path.join(rdir, `R1-ka-tas-strada_${tag}.mp4`), z.w, z.h);
    writeFileSync(path.join(rdir, `R1-ka-tas-strada_${tag}_cover.jpg`), readFileSync(files[1]!.file));
  }
  rmSync(tmp, { recursive: true, force: true });
}, 600_000);
