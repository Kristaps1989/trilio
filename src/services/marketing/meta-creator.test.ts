import { describe, expect, it } from "vitest";
import type { PostFacts } from "@/domain/social/captions";
import { creatorConfigFromEnv, renderAdPicture } from "./meta-creator";

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
    });
  });
});

describe("renderAdPicture", () => {
  it(
    "draws the three products' photos as a square JPEG, and refuses a pick without one",
    { timeout: 60_000 },
    async () => {
      const facts: PostFacts = {
        kind: "picks",
        subcategoryId: "fridge",
        category: "Ledusskapji",
        questions: [],
        picks: [0, 1, 2].map((i) => ({
          name: `Modelis ${i}`,
          priceCents: 49900 + i * 5000,
          shop: "Veikals A",
          imageUrl: ["/sample/fridge-builtin.png", "/sample/kettle-black.png", "/sample/kettle-steel.png"][
            i
          ]!,
        })),
        path: "/izvelies/cool/fridge",
      };
      const jpeg = await renderAdPicture(facts, "https://trilio.test");
      expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
      const sharp = (await import("sharp")).default;
      const meta = await sharp(jpeg).metadata();
      expect([meta.width, meta.height]).toEqual([1080, 1080]);
      const bare = { ...facts, picks: facts.picks.map((p, i) => (i === 1 ? { ...p, imageUrl: null } : p)) };
      await expect(renderAdPicture(bare, "https://trilio.test")).rejects.toThrow("no photo of Modelis 1");
      await expect(
        renderAdPicture(
          { kind: "advice", subcategoryId: "fridge" } as unknown as PostFacts,
          "https://trilio.test",
        ),
      ).rejects.toThrow("not a picks ad");
    },
  );
});
