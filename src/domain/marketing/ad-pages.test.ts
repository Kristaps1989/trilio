import { describe, expect, it } from "vitest";
import type { PostFacts } from "@/domain/social/captions";
import {
  AD_FORMATS,
  cardText,
  closingPage,
  collageBPage,
  collagePage,
  productPage,
  reelCard,
} from "./ad-pages";

// The pages of the agent's Meta ads: always the three products' photos, names and today's prices.

const facts = {
  kind: "picks",
  subcategoryId: "vacuum",
  category: "Putekļsūcēji",
  questions: [],
  picks: [
    { name: "Samsung VC07M25E0WR/SB", priceCents: 8100, shop: "Veikals A", imageUrl: "https://x/1.jpg" },
    { name: "Bosch MoveOn Mini BGC05AAA1", priceCents: 9900, shop: "Veikals B", imageUrl: "https://x/2.jpg" },
    { name: "Philips XC3373/10", priceCents: 27699, shop: "Veikals A", imageUrl: "https://x/3.jpg" },
  ],
  path: "/izvelies/x/vacuum",
} satisfies Extract<PostFacts, { kind: "picks" }>;

describe("the ad pages", () => {
  it("variant A is the light photo collage, variant B the same photos on night green with a question", () => {
    const a = collagePage(facts, "https://trilio.lv");
    expect(a).toMatchObject({ layout: "collage", theme: "light", headline: "Putekļsūcēji" });
    expect(a.images).toEqual(facts.picks.map((p) => p.imageUrl));
    expect(a.rows?.map((r) => r.side)).toEqual(["81 €", "99 €", "276,99 €"].map((s) => s.replace(" ", " ")));
    const b = collageBPage(facts, "https://trilio.lv");
    expect(b).toMatchObject({
      layout: "collage",
      theme: "night",
      headline: "Kurš der tieši tev?",
      eyebrow: "putekļsūcēji",
    });
    expect(b.images).toEqual(a.images);
    expect(b.rows).toEqual(a.rows);
  });

  it("a collage needs three photos", () => {
    const two = { ...facts, picks: facts.picks.map((p, i) => (i === 2 ? { ...p, imageUrl: null } : p)) };
    expect(() => collagePage(two, "https://trilio.lv")).toThrow("not the photo collage");
  });

  it("each product is a card of its own, with its place, name, shop and price", () => {
    expect(productPage(facts, 1)).toMatchObject({
      layout: "pick",
      eyebrow: "B · Putekļsūcēji",
      headline: "Bosch MoveOn Mini BGC05AAA1",
      image: "https://x/2.jpg",
    });
    expect(productPage(facts, 1).stat?.label).toBe("Cena šodien · Veikals B");
    expect(() => productPage({ ...facts, picks: [{ ...facts.picks[0], imageUrl: null }] }, 0)).toThrow(
      "no photo",
    );
    // Carousel cards: Meta cuts a card's name after about 35 characters and its line after 30.
    expect(cardText(facts, 2)).toEqual({ name: "Philips XC3373/10", description: "276,99 € · Veikals A" });
    expect(cardText(facts, 0).description.length).toBeLessThanOrEqual(30);
  });

  it("the Reel is the collage, the three products in turn and what Trilio does", () => {
    const reel = reelCard(facts, "https://trilio.lv");
    expect(reel.slides?.map((s) => s.layout)).toEqual(["collage", "pick", "pick", "pick", "closing"]);
    expect(closingPage(facts)).toMatchObject({ headlineAccent: "Redzi savus trīs.", icons: ["vacuum"] });
    expect(AD_FORMATS).toEqual(["collage", "collage_b", "carousel", "reel"]);
  });
});
