import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import type { Pick } from "@/domain/ranking/rank";
import { pickNotes } from "./pick-notes";

// The posts' product slides say what the results page says: the spec line, and what a pricier
// pick gives and does worse than the cheapest, in the same Latvian words.

const sub = getSubcategory("dish")!;
const pick = (id: string, price: number, attributes: Record<string, unknown>, specs: string | null = null) =>
  ({
    product: { id, name: id, brand: "B", modelCode: id, specs, attributes, imageUrl: null, kwhYear: null },
    offer: { priceCents: price },
    reasons: [],
  }) as unknown as Pick;

describe("pickNotes", () => {
  it("gives each pick its spec line and the pricier ones their differences from the cheapest", () => {
    const keys = sub.compare;
    const base = Object.fromEntries(keys.map((k) => [k, undefined]));
    const noise = keys.includes("noise_db") ? "noise_db" : null;
    const a = pick("a", 37900, { ...base, ...(noise ? { [noise]: 46 } : {}) }, "60 cm · 13 komplekti");
    const b = pick("b", 52999, { ...base, ...(noise ? { [noise]: 42 } : {}) });
    const notes = pickNotes([b, a], sub, 25);
    // The feed's own spec line wins; the cheapest has no differences of its own.
    expect(notes[1]).toEqual({ specs: "60 cm · 13 komplekti", gains: [], tradeoffs: [] });
    if (noise) {
      expect(notes[0]!.gains).toContain("par 4 dB klusāks");
      expect(notes[0]!.specs).toContain("42");
    }
  });

  it("says nothing when the specs are not known on both sides", () => {
    const notes = pickNotes([pick("a", 100, {}), pick("b", 200, {})], sub, 25);
    expect(notes.map((n) => [n.specs, n.gains, n.tradeoffs])).toEqual([
      [null, [], []],
      [null, [], []],
    ]);
  });
});
