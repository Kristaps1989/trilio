import { describe, expect, it } from "vitest";
import type { PostFacts } from "@/domain/social/captions";
import { collageBPage, collagePage, productPage, reelCard } from "@/domain/marketing/ad-pages";
import { adRenderer, creatorConfigFromEnv } from "./meta-creator";

// What making a Meta ad needs, and the picture it carries.

describe("creatorConfigFromEnv", () => {
  it("needs the page and the pixel; the seller's name is who the ad is for and who pays", () => {
    expect(creatorConfigFromEnv({})).toBeNull();
    expect(creatorConfigFromEnv({ META_PAGE_ID: "100200300" })).toBeNull();
    expect(creatorConfigFromEnv({ META_PAGE_ID: "100200300", META_PIXEL_ID: "short" })).toBeNull();
    const cfg = creatorConfigFromEnv({
      META_PAGE_ID: " 100200300 ",
      META_PIXEL_ID: "2161476984461393",
      META_IG_USER_ID: "17840000000000000",
      COMPANY_NAME: "Sky Solutions SIA",
    });
    expect(cfg).toMatchObject({
      pageId: "100200300",
      pixelId: "2161476984461393",
      instagramUserId: "17840000000000000",
      advertiser: "Sky Solutions SIA",
    });
    expect(cfg!.domain).not.toMatch(/^www\./);
    expect(
      creatorConfigFromEnv({ META_PAGE_ID: "100200300", META_PIXEL_ID: "2161476984461393" }),
    ).toMatchObject({
      instagramUserId: null,
      advertiser: "Trilio",
      dsa: null,
    });
    expect(
      creatorConfigFromEnv({
        META_PAGE_ID: "100200300",
        META_PIXEL_ID: "2161476984461393",
        META_DSA_BENEFICIARY: " Trilio ",
      })!.dsa,
    ).toEqual({ beneficiary: "Trilio", payor: "Trilio" });
  });
});

describe("the ads' pictures", () => {
  const facts: PostFacts = {
    kind: "picks",
    subcategoryId: "fridge",
    category: "Ledusskapji",
    questions: [],
    picks: [0, 1, 2].map((i) => ({
      name: `Modelis ${i}`,
      priceCents: 49900 + i * 5000,
      shop: "Veikals A",
      imageUrl: ["/sample/fridge-builtin.png", "/sample/kettle-black.png", "/sample/kettle-steel.png"][i]!,
    })),
    path: "/izvelies/cool/fridge",
  };
  const picks = facts as Extract<PostFacts, { kind: "picks" }>;

  it(
    "are drawn 1:1, 4:5 and 9:16, each product as a card, and a page without a photo is caught",
    { timeout: 120_000 },
    async () => {
      const r = adRenderer();
      expect(await r.missingPhoto(picks)).toBeNull();
      const bare = { ...picks, picks: picks.picks.map((p, i) => (i === 1 ? { ...p, imageUrl: null } : p)) };
      expect(await r.missingPhoto(bare)).toBe("Modelis 1");
      const sharp = (await import("sharp")).default;
      const size = async (jpeg: Buffer) => {
        expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
        const m = await sharp(jpeg).metadata();
        return [m.width, m.height];
      };
      const a = collagePage(picks);
      expect(await size(await r.picture(a, "square"))).toEqual([1080, 1080]);
      expect(await size(await r.picture(a, "portrait"))).toEqual([1080, 1350]);
      expect(await size(await r.picture(collageBPage(picks), "story"))).toEqual([1080, 1920]);
      expect(await size(await r.picture(productPage(picks, 0), "square"))).toEqual([1080, 1080]);
    },
  );

  it("the Reel is an upright MP4 when the server has ffmpeg", { timeout: 180_000 }, async () => {
    const { ffmpegPath, renderReel } = await import("@/services/social/video");
    const mp4 = await renderReel(reelCard(picks, "2026-11-28"), { withSound: false });
    if (!(await ffmpegPath())) return expect(mp4).toBeNull();
    expect(mp4!.subarray(4, 8).toString()).toBe("ftyp");
  });
});
