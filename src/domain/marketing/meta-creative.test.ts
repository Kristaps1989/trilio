import { describe, expect, it } from "vitest";
import { lintPost } from "@/domain/social/lint";
import { adParams } from "@/domain/growth/attribution";
import {
  adLink,
  adName,
  adText,
  AGENT_CAMPAIGN,
  categoriesToAdvertise,
  factsChanged,
  type AdFacts,
} from "./meta-creative";

// The Meta ads the agent makes on its own: honest words, a link Trilio can attribute, and
// the rule that retires an ad whose prices are no longer true.

const facts: AdFacts = {
  category: "Ledusskapji",
  picks: [
    { name: "Bosch KGN36NLEA", priceCents: 49900, shop: "Veikals A" },
    { name: "Samsung RB34", priceCents: 54900, shop: "Veikals B" },
    { name: "LG GBP62", priceCents: 107900, shop: "Veikals A" },
  ],
};

describe("the ad's words", () => {
  it("names the three and their prices in Latvian format, and passes the honesty rules", () => {
    const t = adText(facts);
    expect(t.message).toContain("Ledusskapji: 3 piemēroti varianti šodienas cenās.");
    expect(t.message).toMatch(/• Bosch KGN36NLEA: 499\s€/);
    expect(t.message).toMatch(/• LG GBP62: 1\s079\s€/);
    expect(t.headline).toBe("Ledusskapji: 3 piemēroti varianti");
    const ctx = {
      pricesCents: facts.picks.map((p) => p.priceCents),
      numbers: [3],
      names: facts.picks.map((p) => p.name),
    };
    expect(lintPost(t.message, ctx)).toEqual([]);
    expect(lintPost(t.headline, ctx)).toEqual([]);
    expect(lintPost(t.description, ctx)).toEqual([]);
  });
});

describe("the ad's link", () => {
  it("leads to the category's picks with tags Trilio reads back as this campaign and this ad", () => {
    const name = adName("fridge", "2026-11-24");
    expect(name).toBe("fridge-20261124");
    const link = adLink("https://trilio.lv/", "fridge", name);
    expect(link.startsWith("https://trilio.lv/rezultati?sub=fridge&cena=tipiska&")).toBe(true);
    const read = adParams(Object.fromEntries(new URL(link).searchParams));
    expect(read).toMatchObject({
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: AGENT_CAMPAIGN,
      utmContent: name,
    });
  });
});

describe("when an ad stops being true", () => {
  it("is when a price or a product changed", () => {
    expect(factsChanged(facts, facts)).toBe(false);
    expect(factsChanged(facts, { ...facts, picks: facts.picks.slice(0, 2) })).toBe(true);
    const cheaper = {
      ...facts,
      picks: facts.picks.map((p, i) => (i === 0 ? { ...p, priceCents: 47900 } : p)),
    };
    expect(factsChanged(facts, cheaper)).toBe(true);
    const other = { ...facts, picks: facts.picks.map((p, i) => (i === 2 ? { ...p, name: "Beko B5" } : p)) };
    expect(factsChanged(facts, other)).toBe(true);
    // Another shop at the same price changes nothing the ad says.
    const shop = { ...facts, picks: facts.picks.map((p) => ({ ...p, shop: "Veikals C" })) };
    expect(factsChanged(facts, shop)).toBe(false);
  });
});

describe("which categories get an ad", () => {
  const funnel = [
    { subcategoryId: "hob", resultsVisitors: 37, sent: 0, taps: 0 },
    { subcategoryId: "fridge", resultsVisitors: 53, sent: 2, taps: 10 },
    { subcategoryId: "vacuum", resultsVisitors: 15, sent: 3, taps: 6 },
    { subcategoryId: "washer", resultsVisitors: 56, sent: 0, taps: 11 },
    { subcategoryId: "juicer", resultsVisitors: 3, sent: 0, taps: 0 },
  ];
  const all = new Set(funnel.map((f) => f.subcategoryId));
  it("takes those whose visitors leave e-mails, one per euro of Meta's share, three at most", () => {
    expect(categoriesToAdvertise(funnel, all, 250)).toEqual(["vacuum", "fridge"]);
    expect(categoriesToAdvertise(funnel, all, 900)).toEqual(["vacuum", "fridge", "washer"]);
    expect(categoriesToAdvertise(funnel, all, 100)).toEqual(["vacuum"]);
    expect(categoriesToAdvertise(funnel, all, 99)).toEqual([]);
  });
  it("skips a category that cannot show its picks today", () => {
    expect(categoriesToAdvertise(funnel, new Set(["fridge", "hob"]), 300)).toEqual(["fridge", "hob"]);
    expect(categoriesToAdvertise(funnel, new Set(), 300)).toEqual([]);
  });
});
