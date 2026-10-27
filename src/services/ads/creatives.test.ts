import { describe, expect, it } from "vitest";
import { brandFonts, IMAGE_SIZES, renderCreative } from "./creatives";

describe("creative images", () => {
  it("loads one font file per family and weight, so satori never drops the Latvian subset", async () => {
    const fonts = await brandFonts();
    const keys = fonts.map((f) => `${f.name}/${f.weight}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(IMAGE_SIZES)(
    "renders the %s banner as a PNG",
    async (size) => {
      const res = await renderCreative(
        {
          headline: "Ledusskapis, kas naktī nedūc",
          body: "Salīdzinām troksni, ietilpību un patēriņu.",
          size,
          subcategoryId: "fridge",
        },
        { products: 509, shops: 3 },
      );
      const png = Buffer.from(await res.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      const [w, h] = size.split("x").map(Number);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h]);
      // The first render loads the fonts and the PNG encoder: slow under coverage.
    },
    30_000,
  );
});
