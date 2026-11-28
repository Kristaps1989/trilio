import { describe, expect, it } from "vitest";
import type { PostFacts } from "@/domain/social/captions";
import { AD_FORMATS, cardText, collageBPage, collagePage, productPage, reelCard } from "./ad-pages";

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
  it("variant A opens on the three photos and prices, variant B is the comparison", () => {
    const a = collagePage(facts);
    expect(a).toMatchObject({
      layout: "scene",
      subcategoryId: "vacuum",
      scene: { kind: "hook", eyebrow: "Putekļsūcēji" },
    });
    expect(a.lines.map((l) => l.side)).toEqual(["81\u00a0€", "99\u00a0€", "276,99\u00a0€"]);
    if (a.scene?.kind !== "hook") throw new Error();
    expect(a.scene.picks.map((p) => p.image)).toEqual(facts.picks.map((p) => p.imageUrl));
    const b = collageBPage(facts);
    expect(b).toMatchObject({ layout: "scene", scene: { kind: "compare", headline: "Kuru izvēlēties?" } });
    expect(b.lines).toEqual(a.lines);
  });

  it("each product is a card of its own: its scene, with its shop and price", () => {
    const card = productPage(facts, 1);
    expect(card).toMatchObject({ layout: "scene", title: "Bosch MoveOn Mini BGC05AAA1" });
    expect(card.scene).toMatchObject({ kind: "product", index: 1, pick: { letter: "B", shop: "Veikals B" } });
    expect(card.lines).toEqual([
      { main: "Bosch MoveOn Mini BGC05AAA1", side: "99\u00a0€", sub: "Veikals B" },
    ]);
    expect(() => productPage({ ...facts, picks: [{ ...facts.picks[0], imageUrl: null }] }, 0)).toThrow(
      "no photo",
    );
    // Carousel cards: Meta cuts a card's name after about 35 characters and its line after 30.
    expect(cardText(facts, 2)).toEqual({
      name: "Philips XC3373/10",
      description: "276,99\u00a0€ · Veikals A",
    });
    expect(cardText(facts, 0).description.length).toBeLessThanOrEqual(30);
  });

  it("the Reel is the same scenes, played", () => {
    const reel = reelCard(facts, "2026-11-28");
    expect(reel.reel?.scenes.map((s) => s.kind)).toEqual([
      "hook",
      "product",
      "product",
      "product",
      "compare",
      "cta",
    ]);
    expect(reel.layout).toBe("scene");
    expect(AD_FORMATS).toEqual(["collage", "collage_b", "carousel", "reel"]);
  });
});
