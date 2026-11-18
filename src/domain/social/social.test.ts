import { describe, expect, it } from "vitest";
import { leaks, offerStory } from "./anonymise";
import {
  composePost,
  designOf,
  DESIGNS,
  hashtags,
  reelCaption,
  restyle,
  slideAlt,
  type PostFacts,
} from "./captions";
import { pickPhoto } from "./photos";
import { CROSS_SECONDS, reelFilter, reelPlan, SLIDE_SECONDS } from "./reel";
import { issueAdvice, lintPost, ownerTextBlocks, priceToCents } from "./lint";
import { isoWeek, nextCategory, nextFreeEvening, pickKind, rigaTime, slotsBetween } from "./schedule";

const none = { priceDrop: false, paidOffer: false, topCategories: false, topProducts: false };

describe("schedule", () => {
  it("puts slots at Riga wall-clock time across the summer-time change", () => {
    expect(rigaTime("2026-11-02", 19).toISOString()).toBe("2026-11-02T17:00:00.000Z"); // winter, UTC+2
    expect(rigaTime("2026-07-06", 19).toISOString()).toBe("2026-07-06T16:00:00.000Z"); // summer, UTC+3
  });

  it("lists Monday, Wednesday, Friday 19:00, Saturday and Sunday 11:00", () => {
    const slots = slotsBetween(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-09T00:00:00Z"));
    expect(slots.map((s) => [s.day, s.key])).toEqual([
      ["2026-11-01", "sun"],
      ["2026-11-02", "mon"],
      ["2026-11-04", "wed"],
      ["2026-11-06", "fri"],
      ["2026-11-07", "sat"],
      ["2026-11-08", "sun"],
    ]);
    expect(slots[0]!.at.toISOString()).toBe("2026-11-01T09:00:00.000Z");
  });

  it("fills each slot from what the data allows", () => {
    expect(pickKind({ key: "mon", day: "2026-11-02" }, none)).toBe("picks");
    expect(pickKind({ key: "wed", day: "2026-11-04" }, none)).toBe("advice");
    expect(pickKind({ key: "wed", day: "2026-11-04" }, { ...none, priceDrop: true })).toBe("price_drop");
    expect(pickKind({ key: "fri", day: "2026-11-06" }, { ...none, paidOffer: true, topProducts: true })).toBe(
      "offer",
    );
    // Most-viewed products every other week only.
    const even = isoWeek("2026-11-06") % 2 === 0 ? "2026-11-06" : "2026-11-13";
    const odd = even === "2026-11-06" ? "2026-11-13" : "2026-11-06";
    expect(pickKind({ key: "fri", day: even }, { ...none, topProducts: true })).toBe("top_products");
    expect(pickKind({ key: "fri", day: odd }, { ...none, topProducts: true })).toBe("picks");
    expect(pickKind({ key: "sun", day: "2026-11-08" }, none)).toBeNull();
    expect(pickKind({ key: "sun", day: "2026-11-08" }, { ...none, topCategories: true })).toBe(
      "top_categories",
    );
  });

  it("starts with the owner's four categories, then traffic, never repeating a recent one", () => {
    const known = new Set(["dish", "fridge", "vacuum", "washer", "kettle", "oven"]);
    expect(nextCategory(["kettle"], [], known)).toBe("dish");
    expect(nextCategory(["kettle"], ["dish", "fridge", "vacuum", "washer"], known)).toBe("kettle");
    expect(nextCategory(["kettle"], ["dish", "fridge", "vacuum", "washer", "kettle"], known)).toBe("dish");
  });

  it("finds the next free evening for a post made by hand", () => {
    const now = new Date("2026-11-02T10:00:00Z");
    expect(nextFreeEvening(now, []).toISOString()).toBe("2026-11-02T17:00:00.000Z");
    expect(nextFreeEvening(now, [new Date("2026-11-02T17:00:00Z")]).toISOString()).toBe(
      "2026-11-03T17:00:00.000Z",
    );
  });
});

describe("lintPost", () => {
  it("reads Latvian prices, with thousands", () => {
    expect(priceToCents("1 079,50")).toBe(107950);
    expect(priceToCents("529")).toBe(52900);
  });

  it("allows only the prices and numbers of the data", () => {
    expect(lintPost("Tagad 529,99 € (Veikals).", { pricesCents: [52999] })).toEqual([]);
    expect(lintPost("Tagad 499 €.", { pricesCents: [52999] })).toContain("price 499 € is not in the data");
    expect(lintPost("Piegāde 7 darba dienās.", { numbers: [3] })).toContain("number 7 is not in the data");
  });

  it("ignores links and tags, not the words around them", () => {
    expect(lintPost("Skatīt: https://trilio.lv/x?utm_content=4f0a-99 #trilio")).toEqual([]);
  });

  it("keeps “bez maksas” off the goods and a promised offer conditional", () => {
    expect(lintPost("Sadzīves tehnika no veikaliem, bez maksas.")).toContain(
      "“bez maksas” next to goods: only the service is free",
    );
    expect(lintPost("Padoms bez maksas.")).toEqual([]);
    expect(lintPost("Atsūtīsim piedāvājumu.")).toContain("an offer is promised without “ja”");
    expect(lintPost("Ja varēsim lētāk, atsūtīsim piedāvājumu.")).toEqual([]);
  });

  it("refuses a line in English, as a model sometimes writes one", () => {
    expect(lintPost("Dishwasher noise bothers you in an open kitchen? Vai troksnis ir svarīgs?")).toContain(
      "not Latvian",
    );
    expect(
      lintPost("Trīs ieteikumi: trauku mazgājamās mašīnas. Klusa, 44 dB, atvērtai virtuvei.", {
        numbers: [44],
      }),
    ).toEqual([]);
  });

  it("refuses “tu” in captions and the ads' banned claims", () => {
    expect(lintPost("Tev piemērotākie varianti.")).toContain(
      "informal address: captions avoid the pronoun, or use “jūs”",
    );
    expect(lintPost("Tikai šodien lētākais Latvijā!")).not.toEqual([]);
  });
});

describe("anonymise", () => {
  const order = {
    productName: "Bosch SMV4HTX00E",
    referenceStoreName: "Veikals A",
    referencePriceCents: 64900,
    priceCents: 59900,
    deliveryWorkingDays: 3,
    paidAt: new Date("2026-10-14T09:00:00Z"),
    // Personal fields the story must drop.
    fullName: "Anna Bērziņa",
    email: "anna.berzina@example.lv",
    phone: "+371 2000 0000",
    number: "T-1042",
    street: "Brīvības iela 1",
  };

  it("keeps only the product, the shop, the prices, the days and the month", () => {
    const s = offerStory(order);
    expect(s).toEqual({
      product: "Bosch SMV4HTX00E",
      shop: "Veikals A",
      shopPriceCents: 64900,
      trilioPriceCents: 59900,
      deliveryDays: 3,
      month: "oktobrī",
    });
    expect(JSON.stringify(s)).not.toMatch(/Anna|berzina|2000|1042|Brīvības/i);
  });

  it("finds a personal value in any form, and not inside other words", () => {
    const personal = [order.fullName, order.email, order.phone, order.number, order.street];
    expect(leaks("Paldies, Anna!", personal)).toEqual(["Anna"]);
    expect(leaks("Pasūtījums T 1042", personal)).toEqual(["T-1042"]);
    expect(leaks("Pasūtījums T-1042", personal)).toEqual(["T-1042"]);
    expect(leaks("Zvani 371 20000000", personal)).toEqual(["+371 2000 0000"]);
    expect(leaks("Pannas un katli", personal)).toEqual([]);
  });

  it("an offer post made from a full record carries none of the person's data", () => {
    const s = offerStory(order);
    const post = composePost(
      {
        kind: "offer",
        specialOfferId: "o1",
        subcategoryId: "dish",
        ...s,
        product: s.product,
        path: "/izvelies/kitchen/dish",
      },
      { postId: "p1", baseUrl: "https://trilio.lv" },
    );
    const all = [post.captionFb, post.captionIg, post.alt, JSON.stringify(post.card)].join("\n");
    expect(leaks(all, [order.fullName, order.email, order.phone, order.number, order.street])).toEqual([]);
    expect(post.issues).toEqual([]);
    expect(post.captionFb).toContain("Pircējs oktobrī pajautāja cenu precei Bosch SMV4HTX00E.");
  });
});

describe("composePost", () => {
  const base = { postId: "abc", baseUrl: "https://trilio.lv" };
  const kinds: PostFacts[] = [
    {
      kind: "picks",
      subcategoryId: "dish",
      category: "Trauku mazgājamās mašīnas",
      picks: [
        { name: "Electrolux EEA27200L", priceCents: 37900, shop: "Veikals A" },
        { name: "Bosch SMV2ITX22E", priceCents: 52999, shop: "Veikals B" },
        { name: "AEG FSE73727P", priceCents: 107950, shop: "Veikals C" },
      ],
      path: "/izvelies/kitchen/dish",
    },
    {
      kind: "price_drop",
      subcategoryId: "fridge",
      productId: "p",
      product: "Samsung RB34",
      priceCents: 49900,
      lowCents: 54900,
      shop: "Veikals A",
      path: "/izvelies/cool/fridge",
    },
    {
      kind: "advice",
      subcategoryId: "dish",
      category: "Trauku mazgājamās mašīnas",
      factor: "Atvērtā virtuvē 44 dB un 48 dB ir liela starpība.",
      path: "/izvelies/kitchen/dish",
    },
    {
      kind: "top_categories",
      categories: ["Ledusskapji", "Veļas mašīnas", "Putekļsūcēji", "Tējkannas", "Cepeškrāsnis"].map(
        (label, i) => ({ id: `c${i}`, label }),
      ),
      path: "/",
    },
    {
      kind: "top_products",
      products: [
        { id: "a", name: "Philips XC", priceCents: 19900, shop: "Veikals A" },
        { id: "b", name: "Dyson V8", priceCents: 34900, shop: "Veikals B" },
      ],
      path: "/izvelies/cleaning/vacuum",
    },
  ];

  it.each(kinds)("$kind passes the lint, links with UTM tags and tags Instagram", (f) => {
    const p = composePost(f, base);
    expect(p.issues).toEqual([]);
    expect(p.captionFb).toContain(
      `utm_source=facebook&utm_medium=social&utm_campaign=${f.kind}&utm_content=abc`,
    );
    expect(p.captionIg).toContain("Saite profilā.");
    expect(p.captionIg).not.toContain("http");
    expect(p.captionIg.match(/#\S+/g)).toHaveLength(5);
    expect(p.alt.length).toBeGreaterThan(10);
  });

  it("writes the picks with today's prices in Latvian format", () => {
    const p = composePost(kinds[0]!, base);
    expect(p.captionFb).toContain(`3. AEG FSE73727P — 1${"\u202f"}079,50${"\u00a0"}€ (Veikals C)`);
    expect(p.card.lines).toHaveLength(3);
  });

  it("a picks post with the flow's questions is a four-slide carousel that shows the way", () => {
    const f = {
      ...(kinds[0] as Extract<PostFacts, { kind: "picks" }>),
      questions: [
        { title: "Iebūvējama vai brīvi stāvoša?", options: ["Iebūvējama", "Brīvi stāvoša", "Galda"] },
        { title: "Cik plata?", options: ["45 cm", "60 cm"] },
      ],
    };
    const p = composePost(f, base);
    expect(p.issues).toEqual([]);
    expect(p.card.slides?.map((x) => x.chip)).toEqual(["Izvēle 3 soļos", "1. solis", "2. solis", "3. solis"]);
    expect(p.card.slides![1]!.lines.map((l) => l.chips)).toEqual([
      ["Iebūvējama", "Brīvi stāvoša", "Galda"],
      ["45 cm", "60 cm"],
    ]);
    // Honest about the example: no answers were given for these picks.
    expect(p.card.slides![2]!.note).toContain("Piemērs bez atbildēm");
    expect(p.card.slides![3]!.lines[0]!.buttons).toEqual(["Iegūt lētāk", "Pirkt — Veikals A"]);
    expect(p.captionFb).toContain("Kā tas notiek, redzams bildēs");
    // The facts to re-check before sending stay the three prices.
    expect(p.card.lines.map((l) => l.side)).toHaveLength(3);
    // Without questions it stays one image.
    expect(composePost(kinds[0]!, base).card.slides).toBeUndefined();
  });

  it("one emoji marks the post and one the link: never more than two, never hype", () => {
    const picks = composePost(kinds[0]!, base);
    expect(picks.captionFb.startsWith("🏷️ Trīs ieteikumi:")).toBe(true);
    expect(picks.captionFb).toContain("👉 https://trilio.lv/");
    expect(picks.captionIg.startsWith("🏷️ ")).toBe(true);
    expect(composePost(kinds[1]!, base).captionFb.startsWith("📉 ")).toBe(true);
    expect(composePost(kinds[2]!, base).captionFb.startsWith("💡 ")).toBe(true);
    expect(lintPost("🔥 Tikai pie mums")).toContain("hype emoji");
    expect(lintPost("🏷️ 📉 💡 Trīs")).toContain("more than 2 emojis");
    // ® and ™ in product names are not emojis.
    expect(lintPost("Dyson® Cyclone™ 🏷️")).toEqual([]);
  });

  it("asks one question without “tu”, and leads with the fact", () => {
    for (const f of kinds) {
      const p = composePost(f, base);
      expect(p.captionFb.match(/Rakstiet komentāros\./g)).toHaveLength(1);
    }
    const top = composePost(kinds[3]!, base);
    expect(top.captionFb.split("\n")[0]).toBe("🔎 Šonedēļ Trilio visvairāk meklētā kategorija: ledusskapji.");
  });

  it("the week's lists are carousels: a cover, one slide per item, and the way to start", () => {
    const top = composePost(
      {
        kind: "top_categories",
        categories: [
          { id: "fridge", label: "Ledusskapji", fromCents: 19900 },
          { id: "washer", label: "Veļas mašīnas", fromCents: 24900 },
          { id: "kettle", label: "Tējkannas", fromCents: null },
        ],
        path: "/",
      },
      base,
    );
    expect(top.issues).toEqual([]);
    expect(top.card.slides?.map((x) => x.chip)).toEqual([
      "Ko meklē šonedēļ",
      "1. vieta",
      "2. vieta",
      "3. vieta",
      "Sākt izvēli",
    ]);
    expect(top.card.slides![1]!).toMatchObject({
      subcategoryId: "fridge",
      lines: [{ side: "199\u00a0€" }, {}],
    });
    // No price for a category with no fresh offer.
    expect(top.card.slides![3]!.lines).toHaveLength(1);
    const prod = composePost(kinds[4]!, base);
    expect(prod.card.slides?.length).toBe(3);
    expect(prod.card.slides![1]!.lines[0]!.buttons).toEqual(["Iegūt lētāk", "Pirkt — Veikals A"]);
    // Alt text per slide, from what it shows.
    expect(slideAlt(top.card.slides![1]!)).toBe(
      "Ledusskapji. Cenas partneru veikalos no, 199\u00a0€. Daži jautājumi, un trīs piemērotākie varianti",
    );
  });

  it("a product's photo from the feed goes on its slide and on the phone's card; none when the feed has none", () => {
    const drop = composePost(
      {
        ...(kinds[1] as Extract<PostFacts, { kind: "price_drop" }>),
        imageUrl: "https://cdn.example.lv/a.jpg",
      },
      base,
    );
    expect(drop.card.image).toBe("https://cdn.example.lv/a.jpg");
    expect(drop.card.hero).toBe("fridge");
    expect(composePost(kinds[1]!, base).card).not.toHaveProperty("image");
    const prod = composePost(
      {
        kind: "top_products",
        products: [
          {
            id: "a",
            name: "Philips XC",
            priceCents: 19900,
            shop: "Veikals A",
            imageUrl: "https://cdn.example.lv/p.jpg",
          },
          { id: "b", name: "Dyson V8", priceCents: 34900, shop: "Veikals B", imageUrl: null },
        ],
        path: "/izvelies/cleaning/vacuum",
      },
      base,
    );
    expect(prod.card.slides!.map((s) => s.image)).toEqual([
      undefined,
      "https://cdn.example.lv/p.jpg",
      undefined,
    ]);
    const picks = composePost(
      {
        ...(kinds[0] as Extract<PostFacts, { kind: "picks" }>),
        picks: [
          {
            name: "Electrolux EEA27200L",
            priceCents: 37900,
            shop: "Veikals A",
            imageUrl: "https://cdn.example.lv/e.jpg",
          },
          ...(kinds[0] as Extract<PostFacts, { kind: "picks" }>).picks.slice(1),
        ],
        questions: [{ title: "Cik plata?", options: ["45 cm", "60 cm"] }],
      },
      base,
    );
    expect(picks.card.slides![3]!.phone).toMatchObject({
      kind: "card",
      image: "https://cdn.example.lv/e.jpg",
    });
    // The photo URL is not a word of the post: the lint still passes.
    expect(picks.issues).toEqual([]);
  });

  it("refuses a lead sentence the lint does not pass", () => {
    const p = composePost(kinds[0]!, { ...base, lead: "Tev lētākais Latvijā!" });
    expect(p.issues.length).toBeGreaterThan(0);
  });

  it("puts the category's own tag first", () => {
    expect(hashtags("fridge")[0]).toBe("#ledusskapis");
    expect(hashtags()).toHaveLength(5);
  });
});

// docs/SOCIAL_PLAN.md §14: the designs a kind rotates through, the photos of people, the Reel.
describe("designs", () => {
  const picks = [
    { name: "Bosch KGN36VLED", priceCents: 59900, shop: "Veikals A", imageUrl: "https://shop.example/a.jpg" },
    {
      name: "Samsung RB34C600",
      priceCents: 49900,
      shop: "Veikals B",
      imageUrl: "https://shop.example/b.jpg",
    },
    { name: "LG GBP62DSNGN", priceCents: 69900, shop: "Veikals C" },
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
  const cover = (c: ReturnType<typeof composePost>["card"]) => c.slides?.[0] ?? c;

  it("each kind takes its designs in turn, and no two neighbours share a theme", () => {
    expect([0, 1, 2, 3].map((n) => designOf("picks", n).design)).toEqual([
      "collage",
      "ask",
      "classic",
      "collage",
    ]);
    expect([0, 1, 2].map((n) => designOf("price_drop", n).design)).toEqual(["big", "classic", "big"]);
    for (const kind of Object.keys(DESIGNS) as (keyof typeof DESIGNS)[])
      for (let n = 0; n < 6; n++) expect(designOf(kind, n).theme).not.toBe(designOf(kind, n + 1).theme);
  });

  it("a design changes only the picture: the captions and the facts stay the same", () => {
    const classic = composePost(fridge, { postId: "x", baseUrl: "https://t" });
    for (const design of ["collage", "ask"] as const) {
      const p = composePost(fridge, { postId: "x", baseUrl: "https://t", design });
      expect(p.issues).toEqual([]);
      expect(p.captionFb).toBe(classic.captionFb);
      expect(p.captionIg).toBe(classic.captionIg);
      expect(cover(p.card).lines).toEqual(cover(classic.card).lines);
      expect(cover(p.card).layout).toBe(design);
      expect(p.card.design).toBe(design);
    }
    expect(
      cover(composePost(fridge, { postId: "x", baseUrl: "https://t", design: "collage" }).card),
    ).toMatchObject({
      theme: "light",
      images: ["https://shop.example/a.jpg", "https://shop.example/b.jpg"],
    });
  });

  it("the big figure is the real difference, and only where there is one to show", () => {
    const drop: PostFacts = {
      kind: "price_drop",
      productId: "p",
      subcategoryId: "fridge",
      product: "Samsung RB34C600",
      shop: "Veikals B",
      priceCents: 49900,
      lowCents: 54900,
      path: "/",
    } as PostFacts;
    const big = composePost(drop, { postId: "x", baseUrl: "https://t", design: "big" });
    expect(big.issues).toEqual([]);
    expect(big.card).toMatchObject({
      layout: "big",
      theme: "lime",
      numeral: "−50\u00a0€",
      headline: "zem zemākās cenas pēdējās 30 dienās.",
    });
    const offer = {
      kind: "offer" as const,
      specialOfferId: "o",
      subcategoryId: "fridge",
      product: "Bosch KGN36VLED",
      shop: "Veikals A",
      shopPriceCents: 64900,
      trilioPriceCents: 59900,
      deliveryDays: 3,
      month: "oktobrī",
      path: "/",
    };
    expect(composePost(offer, { postId: "x", baseUrl: "https://t", design: "big" }).card).toMatchObject({
      layout: "big",
      numeral: "−50\u00a0€",
      headline: "lētāk nekā veikalā.",
    });
    // No shop price to compare with: nothing to claim, so the classic picture stays.
    const plain = composePost(
      { ...offer, shopPriceCents: null, shop: null },
      { postId: "x", baseUrl: "https://t", design: "big" },
    );
    expect(plain.card.layout).toBe("offer");
  });

  it("falls back to the classic picture when a design cannot be filled", () => {
    const noPhotos: PostFacts = {
      ...fridge,
      picks: picks.map((p) => ({ name: p.name, priceCents: p.priceCents, shop: p.shop })),
    };
    const base = composePost(noPhotos, { postId: "x", baseUrl: "https://t" }).card;
    expect(restyle(base, noPhotos, "collage")).toBe(base);
    // People need a photo; without one the advice stays as it was.
    const a = composePost(advice, { postId: "x", baseUrl: "https://t" }).card;
    expect(restyle(a, advice, "people", null)).toBe(a);
    expect(
      restyle(a, advice, "people", { url: "https://images.example/p.jpg", credit: "Pexels" }),
    ).toMatchObject({
      layout: "people",
      image: "https://images.example/p.jpg",
      credit: "Pexels",
      headline: "Atvērtā virtuvē 44 dB un 48 dB ir liela starpība.",
    });
  });

  it("picks a photo that fits the category group, in turn", () => {
    const lib = [
      { id: "k", url: "https://i/k.jpg", page: "", credit: "Pexels", groups: ["kitchenbig"] },
      { id: "w", url: "https://i/w.jpg", page: "", credit: "Pexels", groups: ["laundry"] },
      { id: "g", url: "https://i/g.jpg", page: "", credit: "Pexels", groups: ["*"] },
    ];
    expect(pickPhoto("laundry", 0, lib)?.url).toBe("https://i/w.jpg");
    expect(pickPhoto("laundry", 1, lib)?.url).toBe("https://i/g.jpg");
    expect(pickPhoto("laundry", 2, lib)?.url).toBe("https://i/w.jpg");
    expect(pickPhoto("personal", 0, lib)?.url).toBe("https://i/g.jpg");
    expect(pickPhoto(null, 0, [])).toBeNull();
    // The real library: every address is https, and every group that has posts finds a photo.
    for (const g of ["cool", "laundry", "kitchenbig", "clean", "personal"])
      expect(pickPhoto(g, 0)?.url).toMatch(/^https:\/\//);
  });

  it("a generated Reel carries its facts: the caption's prices are checked like a post's", () => {
    const reel: PostFacts = {
      kind: "reel",
      caption: reelCaption(fridge),
      videoUrl: "https://t/v.mp4",
      path: "/",
      of: fridge,
    };
    const p = composePost(reel, { postId: "x", baseUrl: "https://t", design: "collage" });
    expect(p.issues).toEqual([]);
    expect(reel.caption).toContain("Bosch KGN36VLED — 599\u00a0€ (Veikals A)");
    expect(cover(p.card).layout).toBe("collage");
    // A price that is not in the facts is refused, as in any post.
    const wrong = composePost(
      { ...reel, caption: `${reel.caption}\nTagad 199 €.` },
      { postId: "x", baseUrl: "https://t" },
    );
    expect(wrong.issues.join(" ")).toMatch(/price 199 € is not in the data/);
    expect(pickKind({ key: "sat", day: "2026-11-07" }, { ...none, video: true })).toBe("reel");
    expect(pickKind({ key: "sat", day: "2026-11-07" }, none)).toBeNull();
  });

  it("plans a Reel: slides in turn, a sweep at each change, and ffmpeg's graph for it", () => {
    const plan = reelPlan(4);
    expect(plan.slides).toBe(4);
    expect(plan.starts).toEqual([0, 2.45, 4.9, 7.35]);
    expect(plan.total).toBeCloseTo(7.35 + SLIDE_SECONDS, 3);
    expect(plan.sounds.map((s) => s.sound)).toEqual(["pop", "sweep", "sweep", "sweep", "click"]);
    // Never more than six slides, and one slide alone is held five seconds.
    expect(reelPlan(9).slides).toBe(6);
    expect(reelPlan(1)).toMatchObject({ slides: 1, total: 5, starts: [0] });
    const graph = reelFilter(plan, [{ input: 5, at: 0.2, volume: 0.35 }]);
    expect(graph.match(/xfade=transition=slideup/g)).toHaveLength(3);
    expect(graph).toContain(`duration=${CROSS_SECONDS}:offset=2.45`);
    expect(graph).toContain("[4:a][a0]amix=inputs=2");
    expect(graph).toContain("[vout]");
    // Without any sound the silent track alone is the audio.
    expect(reelFilter(reelPlan(1), [])).toContain("[1:a]amix=inputs=1");
  });
});

describe("the owner's own text (owner, 18 Nov 2026)", () => {
  it("is stopped only when empty or too long", () => {
    expect(ownerTextBlocks("Mans Reels: 2 000 € un 47 € 🎬🎥📱")).toEqual([]);
    expect(ownerTextBlocks("  ")).toEqual(["empty"]);
    expect(ownerTextBlocks("x".repeat(2201))).toHaveLength(1);
  });
  it("turns each finding into advice the admin page can word", () => {
    expect(issueAdvice("price 2 000 € is not in the data")).toEqual({
      key: "price",
      values: { value: "2 000 €" },
    });
    expect(issueAdvice("number 445 is not in the data")).toEqual({ key: "number", values: { value: "445" } });
    expect(issueAdvice("more than 2 emojis")).toEqual({ key: "emojis", values: { max: "2" } });
    expect(issueAdvice("fake urgency").key).toBe("urgency");
    expect(issueAdvice("informal address: captions avoid the pronoun, or use “jūs”").key).toBe("informal");
    expect(issueAdvice("something new")).toEqual({ key: "other", values: { text: "something new" } });
  });
  it("lets a Reel the owner shot carry prices that are not in Trilio's data", () => {
    const post = composePost(
      {
        kind: "reel",
        caption: "Kafijas automāti no 479,99 € līdz 2 000 €.",
        videoUrl: "https://v.example/a.mp4",
        path: "/",
      },
      { postId: "p", baseUrl: "https://trilio.lv" },
    );
    expect(post.issues).toEqual([]);
  });
});
