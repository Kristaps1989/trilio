import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { PostFacts } from "@/domain/social/captions";
import { reelTimeline } from "@/domain/social/reel";
import { reelScript, sceneCards } from "@/domain/social/reel-script";
import { geoOf, reelPhotos, renderReelPicture } from "./reel-render";
import { renderPostJpeg } from "./render";

// Every picture of the scene Reel draws upright, without ffmpeg: each scene and step, a price
// line in each of its states, a product without history or photo, and a photo that cannot be had.

const days = (f: (i: number) => number) =>
  Array.from({ length: 10 }, (_, i) => ({
    day: `2026-11-${String(18 + i).padStart(2, "0")}`,
    priceCents: f(i),
  }));
const facts: Extract<PostFacts, { kind: "picks" }> = {
  kind: "picks",
  subcategoryId: "kettle",
  category: "Tējkannas",
  path: "/",
  picks: [
    {
      name: "Philips HD9350/90 tējkanna, 1,7 L, nerūsējošs tērauds",
      priceCents: 3499,
      shop: "Veikals A",
      imageUrl: "/sample/kettle-steel.png",
      tier: "budget",
      specs: "1,7 L · 2200 W",
      history: days((i) => (i < 5 ? 3999 : 3699)),
    },
    {
      name: "Bosch TWK3P420",
      priceCents: 4999,
      shop: "Veikals B",
      imageUrl: "https://127.0.0.1:9/a.jpg",
      tier: "mid",
      recommended: true,
      gains: ["Temperatūras izvēle"],
      specs: "1,7 L · 2400 W · balta",
      history: days(() => 4999),
    },
    {
      name: "Smeg KLF03",
      priceCents: 14900,
      shop: "Veikals A",
      imageUrl: null,
      tier: null,
      specs: "1,7 L · retro",
    },
  ],
};

describe("scene Reel pictures", () => {
  it("draws every scene and step at 1080 × 1920", { timeout: 120_000 }, async () => {
    const variants = [
      reelScript(facts, "2026-11-28"),
      // At the low, and above it, and products with nothing to say beyond their specs.
      reelScript(
        {
          ...facts,
          picks: [
            { ...facts.picks[0]!, priceCents: 3699 },
            { ...facts.picks[1]!, priceCents: 5499, history: days((i) => (i % 2 ? 4999 : 5499)), gains: [] },
            { ...facts.picks[2]!, gains: ["Retro dizains"], tradeoffs: ["Dārgāka"] },
          ],
        },
        "2026-11-28",
      ),
    ];
    for (const script of variants) {
      const photos = await reelPhotos(script);
      expect(photos.get("/sample/kettle-steel.png")).toMatch(/^data:image\/png/);
      expect(photos.get("https://127.0.0.1:9/a.jpg")).toBeUndefined();
      for (const c of reelTimeline(script.scenes).clips) {
        const jpeg = await renderReelPicture(script, c.scene, c.step, photos);
        const m = await sharp(jpeg).metadata();
        expect([m.format, m.width, m.height]).toEqual(["jpeg", 1080, 1920]);
      }
    }
  });

  it(
    "draws every scene as a still for posts and ads: 4:5, square and upright",
    { timeout: 120_000 },
    async () => {
      const slides = sceneCards(reelScript(facts, "2026-11-28"));
      const sizes = { portrait: [1080, 1350], square: [1080, 1080], story: [1080, 1920] } as const;
      for (const [i, slide] of slides.entries())
        for (const shape of ["portrait", "square", "story"] as const) {
          // Not every slide in every shape: each slide once, and each shape for the product slide.
          if (shape !== "portrait" && i !== 1) continue;
          const m = await sharp(await renderPostJpeg(slide, i, slides.length, shape)).metadata();
          expect([m.width, m.height]).toEqual([...sizes[shape]]);
        }
      // A single picture: no carousel marks; the link preview keeps its own layout.
      const one = await sharp(await renderPostJpeg(slides[0]!, 0, 1, "link")).metadata();
      expect([one.width, one.height]).toEqual([1200, 630]);
      expect(geoOf("square")).toMatchObject({ width: 1350, story: false });
      expect(geoOf("story").top).toBeGreaterThan(geoOf("portrait").top);
    },
  );
});
