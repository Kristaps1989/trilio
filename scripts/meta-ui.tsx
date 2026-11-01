import path from "node:path";
import type { ReactNode } from "react";
import sharp from "sharp";
import { Wordmark } from "@/services/ads/creatives";

// The design system of the Meta ads (docs/META_ADS_PHASE1.md): the brand
// ground, the type, and the site's own elements (a question, the
// recommendation card, the two buttons) drawn at poster scale with real data
// from trilio.lv (1 Nov 2026). Shared by the stills and the Reel generators.

export const SRC = path.join(process.cwd(), "assets/ads/meta-phase1-src");
export const OUT = path.join(process.cwd(), "assets/ads/meta-phase1");
export const DATED = "Cenas partneru veikalos 1.11.2026. Cenas mainās.";

export const NIGHT = "#0F2A2E";
export const NIGHT_DEEP = "#0A1F22";
export const NIGHT_SOFT = "#163A3F";
export const LIME = "#D8F45A";
export const MIST = "#F2F5F2";
export const STONE = "#A9BDB9";
export const MUTED = "#5B6E6A";
export const LINE = "#DCE4E1";
export const HEAD = "Space Grotesk";

export type Shape = "feed" | "story" | "square";
export type Z = {
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
export const SIZE: Record<Shape, Z> = {
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

export type Product = {
  name: string;
  model: string;
  price: string;
  shop: string;
  label?: string;
  reason: string;
  photo: string;
};

/** The three picks as the site showed them (brand + model code; the site's own label and reason). */
export const PICKS: Product[] = [
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

export const CRITERIA = ["3–4 cilvēki", "Priekšējā ielāde", "300–700 €"];

export type Photos = Record<string, string>;

export async function photo(name: string, max = 900): Promise<string> {
  // Shops leave wide white margins around the product; trimmed, so every tile shows the machine at the same scale.
  const buf = await sharp(path.join(SRC, `${name}.webp`))
    .flatten({ background: "#FFFFFF" })
    .trim({ threshold: 12 })
    .resize(max, max, { fit: "contain", background: "#FFFFFF" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/* ---------- ground and type ---------- */

export function Ground({ z, children }: { z: Z; children: ReactNode }) {
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

export function Top({ kicker }: { kicker: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Wordmark u={1.1} />
      <div style={{ display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: "0.14em", color: LIME }}>
        {kicker.toUpperCase()}
      </div>
    </div>
  );
}

export function Headline({ z, lines, accent }: { z: Z; lines: string[]; accent?: string }) {
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

export function Foot({ text }: { text: string }) {
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

export const Spacer = () => <div style={{ display: "flex", flex: 1 }} />;

/* ---------- the site's elements, drawn at poster scale ---------- */

export function Chip({ text, k = 1 }: { text: string; k?: number }) {
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

export function Button({ text, kind, k = 1 }: { text: string; kind: "dark" | "lime" | "done"; k?: number }) {
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
      {kind === "done" ? (
        <svg
          width={26 * k}
          height={26 * k}
          viewBox="0 0 24 24"
          fill="none"
          stroke={NIGHT}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      ) : kind === "lime" ? (
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
export function Tile({
  p,
  photos,
  width,
  photoH,
  k = 1,
  reason = false,
  buttons = false,
  priceSize = 40,
  nameRows = 1,
  requested = false,
}: {
  p: Product;
  photos: Photos;
  width: number;
  photoH: number;
  k?: number;
  reason?: boolean;
  buttons?: boolean;
  priceSize?: number;
  /** Lines reserved for the name, so tiles in a row stay equal. */
  nameRows?: 1 | 2;
  /** The site's state after the tap: "Pieprasīts · meklējam labāku cenu". */
  requested?: boolean;
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
          <Button
            text={requested ? "Pieprasīts · meklējam labāku cenu" : "Pieprasīt labāku cenu"}
            kind={requested ? "done" : "lime"}
            k={k}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The first question of the washer flow, as the site asks it. */
export function Question({
  width,
  k = 1,
  selected = true,
  tap = false,
}: {
  width: number;
  k?: number;
  /** The first option chosen (the Reel shows the moment of choosing). */
  selected?: boolean;
  /** The press itself: the option a touch smaller for a few frames. */
  tap?: boolean;
}) {
  const opts: [string, string, boolean][] = [
    ["Priekšējā ielāde", "visizplatītākā", selected],
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
              transform: tap && t === "Priekšējā ielāde" ? "scale(0.97)" : "scale(1)",
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

export function Criteria({ k = 1 }: { k?: number }) {
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
