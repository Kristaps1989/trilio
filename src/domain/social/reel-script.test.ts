import { describe, expect, it } from "vitest";
import type { PostFacts } from "./captions";
import { reelTimeline, SCENE_SECONDS, timelineFilter } from "./reel";
import { reelScript } from "./reel-script";

// The scene Reel (owner, 28 Nov 2026: products, their analysis and price changes, a modern look):
// the three photos with today's prices, a scene per product with its 30-day price line and what
// it gives, a comparison, the call to action; and its timing for ffmpeg.

const week = (price: (i: number) => number) =>
  Array.from({ length: 10 }, (_, i) => ({
    day: `2026-11-${String(18 + i).padStart(2, "0")}`,
    priceCents: price(i),
  }));
const facts: Extract<PostFacts, { kind: "picks" }> = {
  kind: "picks",
  subcategoryId: "fridge",
  category: "Ledusskapji",
  path: "/izvelies/kitchen/fridge",
  picks: [
    {
      name: "Sharp SJ-B",
      priceCents: 19600,
      shop: "Veikals A",
      imageUrl: "https://x/1.jpg",
      tier: "budget",
      specs: "Brīvi stāvošs · 84 cm",
      history: week((i) => (i < 5 ? 21900 : 20900)),
    },
    {
      name: "Bosch KGN36",
      priceCents: 49500,
      shop: "Veikals B",
      imageUrl: "https://x/2.jpg",
      tier: "mid",
      recommended: true,
      gains: ["NoFrost", "Augstāks par 92 cm"],
      tradeoffs: ["Patērē vairāk enerģijas"],
      history: week(() => 49500),
    },
    {
      name: "Dreame Mega",
      priceCents: 51900,
      shop: "Veikals B",
      imageUrl: null,
      tier: "top",
      gains: ["Lielāks tilpums"],
    },
  ],
};

describe("reelScript", () => {
  const script = reelScript(facts, "2026-11-28");

  it("opens on the three, then a scene per product, the comparison and the call to action", () => {
    expect(script.scenes.map((s) => s.kind)).toEqual([
      "hook",
      "product",
      "product",
      "product",
      "compare",
      "cta",
    ]);
    const hook = script.scenes[0]!;
    expect(hook).toMatchObject({ kind: "hook", eyebrow: "Ledusskapji", accent: "Ar cenu 30 dienās." });
    if (hook.kind !== "hook") throw new Error();
    expect(hook.picks.map((p) => [p.letter, p.price, p.best])).toEqual([
      ["A", "196 €", false],
      ["B", "495 €", true],
      ["C", "519 €", false],
    ]);
  });

  it("tells each product: its price line, its strengths against the cheapest, its specs", () => {
    const [a, b, c] = script.scenes.slice(1, 4) as Extract<
      (typeof script.scenes)[number],
      { kind: "product" }
    >[];
    expect(a!.trend).toMatchObject({ status: "below", label: "−13 € zem 30 dienu zemākās" });
    expect(a!.notes).toEqual([
      { mark: "✓", text: "Zemākā cena no trim" },
      { mark: "✓", text: "Par 299 € lētāk nekā labākā izvēle" },
    ]);
    expect(a!.specs).toEqual(["Brīvi stāvošs", "84 cm"]);
    expect(b!.trend?.status).toBe("steady");
    expect(b!.notes.map((n) => n.mark)).toEqual(["+", "+", "−"]);
    // No price history: no line, the specs and notes carry the scene; no photo: the drawing.
    expect(c!.trend).toBeNull();
    expect(c!.pick.image).toBeNull();
    const compare = script.scenes[4]!;
    if (compare.kind !== "compare") throw new Error();
    expect(compare.rows.map((r) => r.note)).toEqual(["Zemākā cena no trim", "NoFrost", "Lielāks tilpums"]);
    expect(script.scenes[5]).toMatchObject({
      kind: "cta",
      sub: "Pērc uzreiz vai pajautā zemāku cenu.",
      button: "trilio.lv",
    });
  });

  it("without any price history the opening says nothing about prices over time", () => {
    const plain = reelScript(
      { ...facts, picks: facts.picks.map((p) => ({ ...p, history: [] })) },
      "2026-11-28",
    );
    expect(plain.scenes[0]).toMatchObject({ accent: "Salīdzinātas īsumā." });
  });
});

describe("reelTimeline", () => {
  const t = reelTimeline(reelScript(facts, "2026-11-28").scenes);

  it("gives a product two steps that fade, and slides between scenes", () => {
    expect(t.clips.map((c) => `${c.scene}.${c.step}`)).toEqual([
      "0.0",
      "1.0",
      "1.1",
      "2.0",
      "2.1",
      "3.0",
      "3.1",
      "4.0",
      "5.0",
    ]);
    expect(t.clips.map((c) => c.into?.transition ?? null)).toEqual([
      null,
      "slideleft",
      "fade",
      "slideleft",
      "fade",
      "slideleft",
      "fade",
      "slideleft",
      "slideleft",
    ]);
    // One push-in runs across a product's two steps, so the fade changes only what is new.
    expect(t.clips[1]!.zoom[1]).toBe(t.clips[2]!.zoom[0]);
    expect(t.clips[2]!.zoom[1]).toBeCloseTo(1.045, 4);
    const sum = t.clips.reduce((a, c) => a + c.seconds - (c.into?.seconds ?? 0), 0);
    expect(t.total).toBeCloseTo(sum, 2);
    expect(t.total).toBeGreaterThan(15);
    expect(t.total).toBeLessThan(25);
    expect(SCENE_SECONDS.product).toEqual([1.4, 3.0]);
    expect(t.sounds.filter((s) => s.sound === "sweep")).toHaveLength(5);
  });

  it("is one ffmpeg graph: a push-in per picture, the transitions at their offsets", () => {
    const g = timelineFilter(t, [{ input: 10, at: 0.2, volume: 0.35 }]);
    expect(g.match(/zoompan/g)).toHaveLength(9);
    expect(g.match(/xfade=transition=fade/g)).toHaveLength(3);
    expect(g.match(/xfade=transition=slideleft/g)).toHaveLength(5);
    expect(g).toContain(`offset=${t.starts[1]}`);
    expect(g).toContain("[9:a][a0]amix=inputs=2");
    expect(g).toContain("[vout]");
  });
});
