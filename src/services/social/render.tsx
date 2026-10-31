import { ImageResponse } from "next/og";
import type { PostCard } from "@/domain/social/captions";
import { TAGLINE } from "@/domain/social/captions";
import { brandFonts, Drawing, Wordmark } from "@/services/ads/creatives";

// The post image (docs/SOCIAL_PLAN.md §3): one brand template for every
// kind, 1080×1350 (4:5), which both Facebook and Instagram show uncropped.
// Night-green background, lime accent, white cards with the facts.

export const POST_SIZE = { width: 1080, height: 1350 } as const;

const NIGHT = "#0F2A2E";
const LIME = "#D8F45A";
const MIST = "#F2F5F2";
const STONE = "#A9BDB9";
const MUTED = "#4E605C";
const glow = `radial-gradient(circle at 85% 12%, rgba(216,244,90,0.18) 0%, rgba(216,244,90,0) 40%), ${NIGHT}`;

export async function renderPost(card: PostCard): Promise<ImageResponse> {
  const many = card.lines.length > 3;
  const text = card.lines.length === 1 && !card.lines[0]!.side;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: glow,
        color: MIST,
        fontFamily: "Figtree",
        padding: 72,
        gap: 36,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark u={1.5} />
        <div
          style={{
            display: "flex",
            border: `3px solid ${LIME}`,
            color: LIME,
            fontWeight: 600,
            fontSize: 30,
            padding: "8px 22px",
            borderRadius: 99,
          }}
        >
          {card.chip}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {card.subcategoryId ? (
          <div style={{ display: "flex", background: MIST, borderRadius: 28, padding: 14 }}>
            <Drawing subcategoryId={card.subcategoryId} size={120} />
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flex: 1,
            fontFamily: "Space Grotesk",
            fontWeight: 700,
            fontSize: card.title.length > 40 ? 54 : 68,
            lineHeight: 1.05,
          }}
        >
          {card.title}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: many ? 14 : 22,
          flex: 1,
          justifyContent: "center",
        }}
      >
        {card.lines.map((l, i) =>
          text ? (
            <div
              key={i}
              style={{ display: "flex", fontSize: 52, lineHeight: 1.25, fontWeight: 600, color: MIST }}
            >
              {l.main}
            </div>
          ) : (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 24,
                background: "#FFFFFF",
                color: NIGHT,
                borderRadius: 28,
                padding: many ? "20px 30px" : "30px 34px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 6 }}>
                <div
                  style={{
                    display: "flex",
                    fontFamily: "Space Grotesk",
                    fontWeight: 700,
                    fontSize: many ? 34 : 38,
                    lineHeight: 1.12,
                  }}
                >
                  {l.main}
                </div>
                {l.sub ? <div style={{ display: "flex", fontSize: 26, color: MUTED }}>{l.sub}</div> : null}
              </div>
              {l.side ? (
                <div style={{ display: "flex", fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 46 }}>
                  {l.side}
                </div>
              ) : null}
            </div>
          ),
        )}
        {card.note ? <div style={{ display: "flex", fontSize: 26, color: STONE }}>{card.note}</div> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            lineHeight: 1.3,
            color: LIME,
            fontWeight: 600,
            maxWidth: 640,
          }}
        >
          {TAGLINE}
        </div>
        <div style={{ display: "flex", fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 40 }}>
          trilio.lv
        </div>
      </div>
    </div>,
    { ...POST_SIZE, fonts: await brandFonts() },
  );
}

/** Instagram takes JPEG only; Facebook takes either. */
export async function renderPostJpeg(card: PostCard): Promise<Buffer> {
  const png = Buffer.from(await (await renderPost(card)).arrayBuffer());
  const sharp = (await import("sharp")).default;
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
