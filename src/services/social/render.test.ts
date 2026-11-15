import { describe, expect, it } from "vitest";
import { composePost, type Design, type PostFacts } from "@/domain/social/captions";
import { loadCover, loadPhoto, POST_SIZE, renderPostJpeg, slidesOf, STORY_SIZE } from "./render";

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

// docs/SOCIAL_PLAN.md §14: the themed designs, upright for a post and tall for a Reel.
describe("themed designs draw", () => {
  const picks = [
    {
      name: "Electrolux EEA27200L",
      priceCents: 37900,
      shop: "Veikals A",
      imageUrl: "/sample/fridge-builtin.png",
    },
    { name: "Bosch SMV2ITX22E", priceCents: 52999, shop: "Veikals B", imageUrl: "/sample/kettle-steel.png" },
    { name: "AEG FSE73727P", priceCents: 79900, shop: "Veikals C", imageUrl: "/sample/kettle-black.png" },
  ];
  const fridge: PostFacts = {
    kind: "picks",
    subcategoryId: "fridge",
    category: "Ledusskapji",
    picks,
    path: "/",
  };
  const advice: PostFacts = {
    kind: "advice",
    subcategoryId: "dish",
    category: "Trauku mazgājamās mašīnas",
    factor: "Atvērtā virtuvē 44 dB un 48 dB ir liela starpība.",
    path: "/",
  };
  const offer: PostFacts = {
    kind: "offer",
    specialOfferId: "o",
    subcategoryId: "fridge",
    product: "Bosch KGN36VLED ledusskapis",
    shop: "Veikals A",
    shopPriceCents: 64900,
    trilioPriceCents: 59900,
    deliveryDays: 3,
    month: "oktobrī",
    imageUrl: "/sample/fridge-builtin.png",
    path: "/",
  };
  const cases: [string, PostFacts, Design][] = [
    ["big", offer, "big"],
    ["collage", fridge, "collage"],
    ["ask with answers", fridge, "ask"],
    ["ask without answers", advice, "ask"],
    ["people", advice, "people"],
  ];

  it.each(cases)(
    "%s",
    async (_name, f, design) => {
      // A photo of people from the design samples stands in for the stock library: no network.
      const post = composePost(f, {
        postId: "s",
        baseUrl: "https://trilio.lv",
        design,
        photo: { url: "/sample/fridge-builtin.png", credit: "test" },
      });
      const [first] = slidesOf(post.card);
      expect(first!.layout).toBe(design);
      const sharp = (await import("sharp")).default;
      const upright = await sharp(await renderPostJpeg(first!)).metadata();
      expect([upright.width, upright.height]).toEqual([POST_SIZE.width, POST_SIZE.height]);
      const tall = await sharp(await renderPostJpeg(first!, 0, 1, "story")).metadata();
      expect([tall.width, tall.height]).toEqual([STORY_SIZE.width, STORY_SIZE.height]);
    },
    120_000,
  );

  it("the lime and light pages are not the night one: the theme reaches the picture", async () => {
    const sharp = (await import("sharp")).default;
    const corner = async (design: Design) => {
      const [first] = slidesOf(
        composePost(fridge, { postId: "s", baseUrl: "https://trilio.lv", design }).card,
      );
      const { data } = await sharp(await renderPostJpeg(first!))
        .extract({ left: 4, top: 4, width: 8, height: 8 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return [data[0]!, data[1]!, data[2]!];
    };
    const [night, lime, light] = [await corner("classic"), await corner("ask"), await corner("collage")];
    // Night green is dark; lime is bright with little blue; the light page is near white.
    expect(night[0]! + night[1]! + night[2]!).toBeLessThan(200);
    expect(lime[1]!).toBeGreaterThan(220);
    expect(lime[2]!).toBeLessThan(140);
    expect(Math.min(...light)).toBeGreaterThan(225);
  }, 120_000);

  it("a people photo that cannot be fetched leaves the drawing in its place", async () => {
    expect(await loadCover(undefined, 900, 560)).toBeUndefined();
    expect(await loadCover("http://example.com/a.jpg", 900, 560)).toBeUndefined();
    expect(await loadCover("https://127.0.0.1:9/a.jpg", 900, 560)).toBeUndefined();
    expect(await loadCover("/sample/fridge-builtin.png", 900, 560)).toMatch(/^data:image\/jpeg;base64,/);
    const post = composePost(advice, {
      postId: "s",
      baseUrl: "https://trilio.lv",
      design: "people",
      photo: { url: "https://127.0.0.1:9/a.jpg", credit: "test" },
    });
    expect((await renderPostJpeg(slidesOf(post.card)[0]!)).length).toBeGreaterThan(20_000);
  }, 60_000);
});
