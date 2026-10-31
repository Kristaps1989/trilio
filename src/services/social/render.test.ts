import { describe, expect, it } from "vitest";
import { composePost, type PostFacts } from "@/domain/social/captions";
import { loadPhoto, renderPostJpeg, slidesOf } from "./render";

// The product photo on a slide: fetched and fitted, or left out so the
// drawing stands in and the post still goes out.

describe("loadPhoto", () => {
  it("reads a design sample, refuses anything but https, and gives up quietly", async () => {
    expect(await loadPhoto(undefined)).toBeUndefined();
    expect(await loadPhoto("/sample/fridge-builtin.png")).toMatch(/^data:image\/png;base64,/);
    expect(await loadPhoto("/etc/passwd")).toBeUndefined();
    expect(await loadPhoto("http://example.com/a.jpg")).toBeUndefined();
    // Nothing listens here: the fetch fails and the slide is drawn without a photo.
    expect(await loadPhoto("https://127.0.0.1:9/a.jpg")).toBeUndefined();
  });
});

describe("renderPostJpeg", () => {
  it("draws a product slide with its photo, and the same slide without one", async () => {
    const card = {
      layout: "drop" as const,
      chip: "Cena samazinājās",
      eyebrow: "Cena samazinājās",
      title: "Samsung RB34",
      hero: "fridge",
      stat: { label: "Tagad · Veikals A", value: "499\u00a0€" },
      stat2: { label: "Zemākā cena pēdējās 30 dienās", value: "549\u00a0€" },
      lines: [{ main: "Tagad", side: "499\u00a0€" }],
    };
    expect(slidesOf(card)).toHaveLength(1);
    for (const image of ["/sample/fridge-builtin.png", "https://127.0.0.1:9/a.jpg", undefined]) {
      const jpeg = await renderPostJpeg(image ? { ...card, image } : card);
      expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(jpeg.length).toBeGreaterThan(20_000);
    }
  }, 60_000);
});

// Every layout of the design system, as the posts compose them: covers with
// and without a drawing, the three phone screens, rank, product, statement,
// drop and offer with and without a photo, closing, and a card saved before
// the layouts existed.
describe("every layout draws", () => {
  const picks = [
    {
      name: "Electrolux EEA27200L",
      priceCents: 37900,
      shop: "Veikals A",
      imageUrl: "/sample/fridge-builtin.png",
    },
    { name: "Bosch SMV2ITX22E", priceCents: 52999, shop: "Veikals B" },
    { name: "AEG FSE73727P", priceCents: 79900, shop: "Veikals C" },
  ];
  const facts: PostFacts[] = [
    {
      kind: "picks",
      subcategoryId: "dish",
      category: "Trauku mazgājamās mašīnas",
      picks,
      path: "/",
      questions: [
        { title: "Iebūvējama vai brīvi stāvoša?", options: ["Iebūvējama", "Brīvi stāvoša", "Galda"] },
        { title: "Cik plata?", options: ["45 cm", "60 cm"] },
      ],
    },
    { kind: "picks", subcategoryId: "fridge", category: "Ledusskapji", picks, path: "/" },
    {
      kind: "top_categories",
      path: "/",
      categories: [
        { id: "airfryer", label: "Taukvāres katli un karstā gaisa friteri", fromCents: 4999 },
        { id: "blender", label: "Kokteiļu blenderi", fromCents: 2999 },
        { id: "coffee", label: "Kafijas automāti", fromCents: null },
        { id: "micro", label: "Mikroviļņu krāsnis", fromCents: 6900 },
      ],
    },
    {
      kind: "advice",
      subcategoryId: "dish",
      category: "Trauku mazgājamās mašīnas",
      factor: "Atvērtā virtuvē 44 dB un 48 dB ir liela starpība.",
      path: "/",
    },
    {
      kind: "offer",
      specialOfferId: "o",
      subcategoryId: "dish",
      product: "Bosch SMV4HTX00E",
      shop: "Veikals A",
      shopPriceCents: 64900,
      trilioPriceCents: 59900,
      deliveryDays: 3,
      month: "oktobrī",
      imageUrl: "/sample/kettle-steel.png",
      path: "/",
    },
    {
      kind: "offer",
      specialOfferId: "o2",
      subcategoryId: "dish",
      product: "Bosch SMV4HTX00E",
      shop: null,
      shopPriceCents: null,
      trilioPriceCents: 59900,
      deliveryDays: 3,
      month: "oktobrī",
      path: "/",
    },
    {
      kind: "top_products",
      path: "/",
      products: [
        {
          id: "a",
          name: "Philips XC8349/01",
          priceCents: 19900,
          shop: "Veikals A",
          subcategoryId: "vacuum",
          imageUrl: "/sample/kettle-black.png",
        },
        { id: "b", name: "Dyson V15 Detect", priceCents: 54900, shop: "Veikals B", subcategoryId: "vacuum" },
      ],
    },
  ];

  it.each(facts)(
    "$kind",
    async (f) => {
      const slides = slidesOf(composePost(f, { postId: "s", baseUrl: "https://trilio.lv" }).card);
      for (const [i, s] of slides.entries()) {
        const jpeg = await renderPostJpeg(s, i, slides.length);
        expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      }
    },
    120_000,
  );

  it("the link preview of every kind is 1200 × 630", async () => {
    const sharp = (await import("sharp")).default;
    for (const f of facts) {
      const [first] = slidesOf(composePost(f, { postId: "s", baseUrl: "https://trilio.lv" }).card);
      const meta = await sharp(await renderPostJpeg(first!, 0, 1, "link")).metadata();
      expect([meta.width, meta.height]).toEqual([1200, 630]);
    }
  }, 120_000);

  it("a card saved before the layouts existed, and a long list", async () => {
    const legacy = {
      chip: "3 ieteikumi",
      title: "Ledusskapji",
      lines: picks.map((p) => ({ main: p.name, side: "379\u00a0€", sub: p.shop })),
      note: "Cenas šodien partneru veikalos",
    };
    expect((await renderPostJpeg(legacy)).length).toBeGreaterThan(20_000);
    const long = { ...legacy, lines: [...legacy.lines, ...legacy.lines] };
    expect((await renderPostJpeg(long)).length).toBeGreaterThan(20_000);
  }, 60_000);
});
