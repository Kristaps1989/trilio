import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import sharp from "sharp";
import { it } from "vitest";
import { brandFonts } from "@/services/ads/creatives";

// Meta Phase 1 ads (docs/META_ADS_PHASE1.md). Product-led and designed, not
// screenshots: the site's own elements (a question, the recommendation card,
// the two buttons) are drawn here at poster scale with real data from
// trilio.lv/rezultati?sub=washer on 1 Nov 2026 (three picks for 3–4 people,
// front loading, 300–700 €) and the shops' product photos. Every picture
// with a price carries the date. Run: npm run creatives:meta.

import {
  OUT,
  DATED,
  SIZE,
  PICKS,
  photo,
  Ground,
  Top,
  Headline,
  Foot,
  Spacer,
  Button,
  Tile,
  Question,
  Criteria,
  type Photos,
  type Shape,
  type Z,
} from "./meta-ui";

/* ---------- the ads ---------- */

function Three({ z, photos }: { z: Z; photos: Photos }) {
  const gap = 18;
  const w = Math.floor((z.w - 2 * z.side - 2 * gap) / 3);
  return (
    <div style={{ display: "flex", gap, alignItems: "flex-start" }}>
      {PICKS.map((p) => (
        <Tile
          key={p.model}
          p={p}
          photos={photos}
          width={w}
          photoH={z.threeP}
          k={z.threeK}
          priceSize={38}
          nameRows={2}
        />
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
