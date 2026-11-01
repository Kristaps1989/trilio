import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
// with a price carries the date. Run: npm run creatives:meta (stills) and
// npm run creatives:reel (the Reel, scripts/meta-reel.gen.tsx).

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

/**
 * 1.91:1: the same five ideas laid out side by side, the text in a left
 * column and the site element on the right, so Meta does not crop the
 * 4:5 for Audience Network, Messenger and the desktop right column.
 */
const WZ = SIZE.wide;
function WideAd({
  kicker,
  lines,
  accent,
  left,
  criteria = false,
  foot,
  hero,
}: {
  kicker: string;
  lines: string[];
  accent?: string;
  /** Width of the text column; the hero takes the rest. */
  left: number;
  criteria?: boolean;
  foot: string;
  hero: ReactNode;
}) {
  return (
    <Ground z={WZ}>
      <Top kicker={kicker} />
      <div style={{ display: "flex", flex: 1, gap: 36, alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", width: left, flexShrink: 0 }}>
          <Headline z={WZ} lines={lines} accent={accent} />
          {criteria ? (
            <div style={{ display: "flex", paddingTop: 20 }}>
              <Criteria k={0.62} />
            </div>
          ) : null}
          <Spacer />
          <Foot text={foot} />
        </div>
        <div style={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}>{hero}</div>
      </div>
    </Ground>
  );
}

function ThreeWide({ photos, width }: { photos: Photos; width: number }) {
  const gap = 14;
  const w = Math.floor((width - 2 * gap) / 3);
  return (
    <div style={{ display: "flex", gap, alignItems: "flex-start" }}>
      {PICKS.map((p) => (
        <Tile
          key={p.model}
          p={p}
          photos={photos}
          width={w}
          photoH={WZ.threeP}
          k={WZ.threeK}
          priceSize={38}
          nameRows={2}
        />
      ))}
    </div>
  );
}

const WIDE: Record<keyof typeof ADS, (ph: Photos) => ReactNode> = {
  "A1-tris-ieteikumi": (ph) => (
    <WideAd
      kicker="Veļas mašīnas"
      lines={["Daži jautājumi."]}
      accent="Trīs ieteikumi."
      left={400}
      criteria
      foot={DATED}
      hero={<ThreeWide photos={ph} width={WZ.w - 2 * WZ.side - 400 - 36} />}
    />
  ),
  "A2-pieprasi-labaku-cenu": (ph) => (
    <WideAd
      kicker="Pie katra ieteikuma"
      lines={["Patīk modelis?"]}
      accent="Pieprasi labāku cenu."
      left={540}
      foot="Pajautāsim izplatītājam. Ja varēsim lētāk, atsūtīsim piedāvājumu; ja ne, paziņosim, kad cena kritīs."
      hero={<Tile p={PICKS[0]!} photos={ph} width={WZ.one} photoH={WZ.oneP} k={WZ.k} buttons />}
    />
  ),
  "A3-dazi-jautajumi": () => (
    <WideAd
      kicker="Veļas mašīnas"
      lines={["Kuru izvēlēties?"]}
      accent="Daži jautājumi."
      left={520}
      foot="Tikai jautājumi, kas izšķir izvēli. Pēc tiem trīs piemērotākie modeļi."
      hero={<Question width={WZ.one + 20} k={WZ.k} />}
    />
  ),
  "A4-piemerotakais-modelis": (ph) => (
    <WideAd
      kicker="Veļas mašīnas"
      lines={["Piemērotākais modelis"]}
      accent="atbilstoši kritērijiem."
      left={460}
      criteria
      foot={DATED}
      hero={<Tile p={PICKS[0]!} photos={ph} width={WZ.one + 60} photoH={WZ.oneP + 10} k={WZ.k} reason />}
    />
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

const SHAPES: [Shape, string][] = [
  ["feed", "4x5_1080x1350"],
  ["story", "9x16_1080x1920"],
  ["square", "1x1_1080x1080"],
  ["wide", "1.91x1_1200x628"],
];

it("renders the Meta Phase 1 set", async () => {
  const ph: Photos = {
    "product-1": await photo("product-1"),
    "product-2": await photo("product-2"),
    "product-3": await photo("product-3"),
  };
  // Only the stills: the Reel (R1, npm run creatives:reel) stays as it is.
  for (const [name, ad] of Object.entries(ADS)) {
    const dir = path.join(OUT, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [shape, tag] of SHAPES) {
      const z = SIZE[shape];
      const node = shape === "wide" ? WIDE[name]!(ph) : ad(z, ph);
      writeFileSync(path.join(dir, `${name}_${tag}.jpg`), await jpeg(node, z.w, z.h));
    }
  }
  const cdir = path.join(OUT, "A5-karuselis");
  rmSync(cdir, { recursive: true, force: true });
  mkdirSync(cdir, { recursive: true });
  for (const [name, c] of Object.entries(CARDS))
    writeFileSync(
      path.join(cdir, `A5-karte-${name}_1x1_1080x1080.jpg`),
      await jpeg(<CarouselCard c={c} ph={ph} />, 1080, 1080),
    );
}, 600_000);
