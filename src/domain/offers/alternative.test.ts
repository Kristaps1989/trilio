import { describe, expect, it } from "vitest";
import {
  alternativePriceProblems,
  compareProducts,
  descriptionIssues,
  parseTypedAttributes,
  downsides,
  mayOfferAlternativeDirectly,
  pickSuggestions,
  requestChip,
  suggestNothing,
  undecided,
  type RequestFacts,
} from "./alternative";

describe("compareProducts", () => {
  const keys = ["capacity_kg", "energy_class", "noise_db", "spin_rpm", "install", "steam"];

  it("calls it equivalent only when nothing is worse, different or unstated", () => {
    const c = compareProducts(
      { capacity_kg: 8, energy_class: "B", noise_db: 72, spin_rpm: 1400 },
      { capacity_kg: 9, energy_class: "A", noise_db: 72, spin_rpm: 1400 },
      keys,
      "washer",
    );
    expect(c.label).toBe("equivalent");
    expect(c.lines.map((l) => [l.attr, l.verdict])).toEqual([
      ["capacity_kg", "better"],
      ["energy_class", "better"],
      ["noise_db", "same"],
      ["spin_rpm", "same"],
    ]);
  });

  it("names a worse line and says similar", () => {
    const c = compareProducts(
      { capacity_kg: 8, noise_db: 70 },
      { capacity_kg: 8, noise_db: 76 },
      keys,
      "washer",
    );
    expect(c.label).toBe("similar");
    expect(downsides(c).map((l) => l.attr)).toEqual(["noise_db"]);
  });

  it("never counts missing data as the same", () => {
    const c = compareProducts({ capacity_kg: 8, noise_db: 70 }, { capacity_kg: 8 }, keys, "washer");
    expect(c.lines.find((l) => l.attr === "noise_db")?.verdict).toBe("unknown");
    expect(c.label).toBe("similar");
  });

  it("marks a different installation or type as different, not better or worse", () => {
    const c = compareProducts({ install: "built_in" }, { install: "freestanding" }, ["install"], "washer");
    expect(c.lines[0]!.verdict).toBe("different");
    expect(c.label).toBe("similar");
  });

  it("treats a fact only the alternative states as neutral, and skips lines nobody states", () => {
    const c = compareProducts({ capacity_kg: 8 }, { capacity_kg: 8, steam: true }, keys, "washer");
    expect(c.lines.map((l) => [l.attr, l.verdict])).toEqual([
      ["capacity_kg", "same"],
      ["steam", "neutral"],
    ]);
    expect(c.label).toBe("equivalent");
  });

  it("is never equivalent with nothing to compare", () => {
    expect(compareProducts({}, { steam: true }, keys, "washer").label).toBe("similar");
  });
});

describe("alternativePriceProblems", () => {
  it("blocks an offer that does not beat the alternative's shop price", () => {
    expect(
      alternativePriceProblems({
        offerCents: 50_000,
        alternativeShopCents: 50_000,
        originalSeenCents: 60_000,
      }),
    ).toEqual(["not_below_shop"]);
  });
  it("blocks an offer above the original's price the shopper saw", () => {
    expect(
      alternativePriceProblems({
        offerCents: 61_000,
        alternativeShopCents: 70_000,
        originalSeenCents: 60_000,
      }),
    ).toEqual(["above_original"]);
  });
  it("passes a price below both, and skips checks with no price to compare", () => {
    expect(
      alternativePriceProblems({
        offerCents: 55_000,
        alternativeShopCents: 59_900,
        originalSeenCents: 60_000,
      }),
    ).toEqual([]);
    expect(
      alternativePriceProblems({ offerCents: 55_000, alternativeShopCents: null, originalSeenCents: null }),
    ).toEqual([]);
  });
});

describe("pickSuggestions", () => {
  it("keeps other makers in stock, best ranked first, at most five", () => {
    const list = [
      { id: "a", brand: "Bosch", shopCents: 50_000, value: 90 },
      { id: "b", brand: "LG", shopCents: 52_000, value: 80 },
      { id: "c", brand: "Samsung", shopCents: null, value: 99 },
      { id: "d", brand: "Electrolux", shopCents: 48_000, value: 85 },
      { id: "e", brand: "lg", shopCents: 47_000, value: 80 },
      { id: "f", brand: "AEG", shopCents: 1, value: 1 },
      { id: "g", brand: "Beko", shopCents: 1, value: 2 },
      { id: "h", brand: "Gorenje", shopCents: 1, value: 3 },
    ];
    expect(pickSuggestions(list, { id: "x", brand: "BOSCH" }).map((s) => s.id)).toEqual([
      "d",
      "e",
      "b",
      "h",
      "g",
    ]);
  });
});

describe("suggestNothing", () => {
  const base = { partnersAsked: [], bestShopCents: 50_000, minMarginPct: 3, alternativeAvailable: true };

  it("says the partner can't be cheaper when cost plus margin reaches the shops", () => {
    expect(suggestNothing({ ...base, partner: { status: "confirmed", costCents: 48_600 } })).toBe(
      "partner_not_cheaper",
    );
    expect(suggestNothing({ ...base, partner: { status: "confirmed", costCents: 48_000 } })).toBeNull();
  });

  it("says there is no alternative when the product is unavailable and none passes", () => {
    expect(
      suggestNothing({
        ...base,
        alternativeAvailable: false,
        partner: { status: "unavailable", costCents: null },
        partnersAsked: [{ status: "unavailable" }],
      }),
    ).toBe("no_alternative");
    expect(
      suggestNothing({ ...base, partner: { status: "unavailable", costCents: null }, partnersAsked: [] }),
    ).toBeNull();
  });

  it("says every partner refused when more than one was asked and all said no", () => {
    expect(
      suggestNothing({
        ...base,
        partner: { status: "unavailable", costCents: null },
        partnersAsked: [{ status: "unavailable" }, { status: "unavailable" }],
      }),
    ).toBe("all_partners_refused");
  });

  it("suggests nothing while waiting for a partner", () => {
    expect(suggestNothing({ ...base, partner: { status: "requested", costCents: null } })).toBeNull();
    expect(suggestNothing({ ...base, partner: null })).toBeNull();
  });
});

describe("requestChip", () => {
  const f: RequestFacts = {
    wantsOffers: true,
    worthAsking: true,
    offered: false,
    outcome: null,
    partner: null,
    ended: false,
  };
  it("moves from new to requested, and an answer wins", () => {
    expect(requestChip(f)).toBe("new");
    expect(requestChip({ ...f, partner: "requested" })).toBe("requested");
    expect(requestChip({ ...f, partner: "unavailable", outcome: "nothing_to_offer" })).toBe(
      "nothing_to_offer",
    );
    expect(requestChip({ ...f, offered: true, outcome: "nothing_to_offer" })).toBe("offered");
    expect(requestChip({ ...f, ended: true, offered: true })).toBe("ended");
  });
  it("puts cheap products and people without offers consent on monitoring only", () => {
    expect(requestChip({ ...f, worthAsking: false })).toBe("monitoring_only");
    expect(requestChip({ ...f, wantsOffers: false })).toBe("monitoring_only");
  });
  it("counts only new and requested as waiting for Trilio", () => {
    expect(undecided("new")).toBe(true);
    expect(undecided("requested")).toBe(true);
    expect(undecided("alternative_asked")).toBe(false);
    expect(undecided("monitoring_only")).toBe(false);
  });
});

describe("mayOfferAlternativeDirectly", () => {
  it("only under the consent text that mentions an alternative", () => {
    expect(mayOfferAlternativeDirectly("2026-11-16")).toBe(true);
    expect(mayOfferAlternativeDirectly("2026-11-16.1")).toBe(true);
    expect(mayOfferAlternativeDirectly("2026-11-09.2")).toBe(false);
    expect(mayOfferAlternativeDirectly(null)).toBe(false);
  });
});

describe("descriptionIssues", () => {
  it("lets a plain, factual description through", () => {
    expect(descriptionIssues("Klusa, ar tvaika programmu un 10 gadu motora garantiju.", "similar")).toEqual(
      [],
    );
  });
  it("blocks urgency, superlatives, shouting and an equivalent claim the comparison does not allow", () => {
    expect(descriptionIssues("Tikai šodien! Pēdējie 2 gab.", null)).toContain("urgency");
    expect(descriptionIssues("Lētākais Latvijā", null)).toContain("superlative");
    expect(descriptionIssues("SUPERCENA!!", null)).toContain("shouting");
    expect(descriptionIssues("Pilnīgi līdzvērtīgs modelis", "similar")).toEqual(["equivalent_claim"]);
    expect(descriptionIssues("Pilnīgi līdzvērtīgs modelis", "equivalent")).toEqual([]);
    expect(descriptionIssues("a".repeat(1501), null)).toEqual(["too_long"]);
  });
});

describe("parseTypedAttributes", () => {
  it("reads numbers with a decimal comma, yes and no, and skips blanks", () => {
    expect(
      parseTypedAttributes([
        ["capacity_kg", "8,5"],
        ["steam", "jā"],
        ["inverter", "nav"],
        ["loading", "front"],
        ["noise_db", " "],
      ]),
    ).toEqual({ capacity_kg: 8.5, steam: true, inverter: false, loading: "front" });
  });
});
