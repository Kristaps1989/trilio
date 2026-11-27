import { describe, expect, it } from "vitest";
import { lintPost } from "@/domain/social/lint";
import { adParams } from "@/domain/growth/attribution";
import {
  adLink,
  adName,
  adText,
  AD_LOOK,
  AGENT_CAMPAIGN,
  carouselCreative,
  placementCreative,
  videoCreative,
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
    expect(name).toBe("fridge-a-20261124");
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
    // An ad drawn in an older look is replaced, even when its prices still hold.
    expect(factsChanged(facts, { ...facts, look: AD_LOOK })).toBe(true);
    expect(factsChanged({ ...facts, look: AD_LOOK }, { ...facts, look: AD_LOOK })).toBe(false);
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
  it("takes those whose visitors leave e-mails, one per euro of Meta's share, two at most (each has four ads)", () => {
    expect(categoriesToAdvertise(funnel, all, 250)).toEqual(["vacuum", "fridge"]);
    expect(categoriesToAdvertise(funnel, all, 900)).toEqual(["vacuum", "fridge"]);
    expect(categoriesToAdvertise(funnel, all, 100)).toEqual(["vacuum"]);
    expect(categoriesToAdvertise(funnel, all, 99)).toEqual([]);
  });
  it("skips a category that cannot show its picks today", () => {
    expect(categoriesToAdvertise(funnel, new Set(["fridge", "hob"]), 300)).toEqual(["fridge", "hob"]);
    expect(categoriesToAdvertise(funnel, new Set(), 300)).toEqual([]);
  });
});

describe("the creatives Meta is sent", () => {
  const who = { pageId: "100200300", instagramUserId: "17840000000000000" };
  const words = { link: "https://trilio.lv/r", message: "m", headline: "h", description: "d" };

  it("names each format's ad apart, so the link says which one brought the e-mail", () => {
    expect(adName("fridge", "2026-11-27")).toBe("fridge-a-20261127");
    expect(adName("fridge", "2026-11-27", "collage_b")).toBe("fridge-b-20261127");
    expect(adName("fridge", "2026-11-27", "carousel")).toBe("fridge-karusele-20261127");
    expect(adName("fridge", "2026-11-27", "reel")).toBe("fridge-reel-20261127");
  });

  it("shapes pictures per placement: 4:5 in feeds, 9:16 in stories, square elsewhere", () => {
    const c = placementCreative(who, words, { square: "sq", portrait: "pt", story: "st" }, "fridge-a") as {
      object_story_spec: unknown;
      asset_feed_spec: {
        ad_formats: string[];
        images: { hash: string; adlabels: { name: string }[] }[];
        asset_customization_rules: {
          customization_spec: Record<string, string[]>;
          image_label: { name: string };
        }[];
        link_urls: { website_url: string }[];
      };
    };
    expect(c.object_story_spec).toEqual({ page_id: "100200300", instagram_user_id: "17840000000000000" });
    const spec = c.asset_feed_spec;
    expect(spec.ad_formats).toEqual(["SINGLE_IMAGE"]);
    const label = (hash: string) => spec.images.find((i) => i.hash === hash)!.adlabels[0]!.name;
    const rule = (name: string) => spec.asset_customization_rules.find((r) => r.image_label.name === name)!;
    expect(rule(label("pt")).customization_spec.instagram_positions).toContain("stream");
    expect(rule(label("pt")).customization_spec.facebook_positions).toContain("feed");
    expect(rule(label("st")).customization_spec.instagram_positions).toEqual(["story"]);
    expect(rule(label("sq")).customization_spec.facebook_positions).toContain("right_hand_column");
    expect(spec.link_urls).toEqual([{ website_url: "https://trilio.lv/r" }]);
    // Every position is shown by one rule only.
    const seen = spec.asset_customization_rules.flatMap((r) =>
      Object.entries(r.customization_spec)
        .filter(([k]) => k.endsWith("_positions"))
        .flatMap(([k, v]) => v.map((p) => `${k}:${p}`)),
    );
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("a carousel keeps the tiers' order and has no end card; a video has its thumbnail and button", () => {
    const car = carouselCreative(
      { pageId: "1" },
      words,
      [0, 1, 2].map((i) => ({ imageHash: `h${i}`, name: `n${i}`, description: `d${i}` })),
      "fridge-karusele",
    ) as { object_story_spec: { instagram_user_id?: string; link_data: Record<string, unknown> } };
    expect(car.object_story_spec.instagram_user_id).toBeUndefined();
    expect(car.object_story_spec.link_data).toMatchObject({
      multi_share_optimized: false,
      multi_share_end_card: false,
      message: "m",
    });
    expect(
      (car.object_story_spec.link_data.child_attachments as { image_hash: string }[]).map(
        (c) => c.image_hash,
      ),
    ).toEqual(["h0", "h1", "h2"]);
    expect(videoCreative(who, words, "777", "thumb", "fridge-reel")).toEqual({
      name: "fridge-reel",
      object_story_spec: {
        page_id: "100200300",
        instagram_user_id: "17840000000000000",
        video_data: {
          video_id: "777",
          image_hash: "thumb",
          message: "m",
          title: "h",
          link_description: "d",
          call_to_action: { type: "LEARN_MORE", value: { link: "https://trilio.lv/r" } },
        },
      },
    });
  });
});
