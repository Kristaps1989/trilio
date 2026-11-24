import { describe, expect, it } from "vitest";
import {
  checkSeoText,
  expectedCtr,
  landingOf,
  missedClicks,
  pickPages,
  trialVerdict,
  type PageSearch,
} from "./agent";

// The SEO agent's rules: which pages get a new title, what may go out, and when a change is taken back.

const page = (path: string, impressions: number, clicks: number, position: number): PageSearch => ({
  path,
  impressions,
  clicks,
  position,
  queries: [],
});

describe("landingOf", () => {
  it("reads a category page's address, with or without a budget", () => {
    expect(landingOf("/kategorija/fridge")).toEqual({ sub: "fridge", budgetEur: null });
    expect(landingOf("/kategorija/fridge/lidz-800")).toEqual({ sub: "fridge", budgetEur: 800 });
    expect(landingOf("/kategorija/fridge/")).toEqual({ sub: "fridge", budgetEur: null });
    expect(landingOf("/")).toBeNull();
    expect(landingOf("/rezultati")).toBeNull();
    expect(landingOf("/en/kategorija/fridge")).toBeNull();
    expect(landingOf("/kategorija/fridge/lidz-abc")).toBeNull();
  });
});

describe("pickPages", () => {
  it("takes category pages that are seen and passed over, most missed clicks first", () => {
    const pages = [
      page("/kategorija/fridge", 400, 4, 8), // expects 10 clicks, has 4
      page("/kategorija/washer", 900, 5, 12), // expects 9, has 5
      page("/kategorija/vacuum", 200, 9, 9), // clicked more than an ordinary result
      page("/kategorija/kettle", 20, 0, 6), // shown too rarely to tell
      page("/kategorija/oven", 500, 0, 35), // page four: a title will not fix that
      page("/kategorija/hob", 300, 1, 2), // already at the top
      page("/", 5000, 10, 9), // not a category page
    ];
    expect(pickPages(pages, new Set()).map((p) => p.path)).toEqual([
      "/kategorija/fridge",
      "/kategorija/washer",
    ]);
    expect(pickPages(pages, new Set(["/kategorija/fridge"])).map((p) => p.path)).toEqual([
      "/kategorija/washer",
    ]);
    expect(pickPages(pages, new Set(), 1)).toHaveLength(1);
  });
  it("knows what an ordinary result gets at a position", () => {
    expect(expectedCtr(1)).toBe(0.1);
    expect(expectedCtr(4.5)).toBe(0.06);
    expect(expectedCtr(8)).toBe(0.025);
    expect(expectedCtr(15)).toBe(0.01);
    expect(missedClicks({ impressions: 400, clicks: 4, position: 8 })).toBeCloseTo(6);
  });
});

describe("checkSeoText", () => {
  const ctx = { category: "Ledusskapji", allowedNumbers: [3, 2026, 800] };
  const good = {
    title: "Labākie ledusskapji līdz 800 € (2026): 3 varianti",
    description:
      "Trīs piemērotākie ledusskapji līdz 800 € partneru veikalos ar šodienas cenām. Atbildi uz dažiem jautājumiem vai pajautā zemāku cenu.",
  };
  it("lets an honest text of the right length through", () => {
    expect(checkSeoText(good, ctx)).toEqual([]);
  });
  it("stops what is too long, too short, off the category, shouted or dishonest", () => {
    expect(checkSeoText({ ...good, title: "x".repeat(61) }, ctx)).toContain(
      "title longer than 60 characters",
    );
    expect(checkSeoText({ ...good, description: `Ledusskapji ${"x".repeat(150)}` }, ctx)).toContain(
      "description longer than 155 characters",
    );
    expect(checkSeoText({ ...good, description: "Ledusskapji veikalos." }, ctx)).toContain(
      "description shorter than 70 characters",
    );
    expect(checkSeoText({ ...good, title: "Labākā tehnika mājai 2026" }, ctx)).toContain(
      "title does not name the category",
    );
    expect(checkSeoText({ ...good, title: "LEDUSSKAPJI līdz 800 €" }, ctx)).toContain("shouting");
    expect(checkSeoText({ ...good, title: "Lētākie ledusskapji Latvijā" }, ctx)).toContain("cheapest claim");
    // "Pajautā zemāku cenu" is what Trilio does, and stays allowed.
    expect(
      checkSeoText({ ...good, description: `${good.description.slice(0, 100)} Lētāk nekā domā.` }, ctx),
    ).not.toContain("cheapest claim");
    expect(checkSeoText({ ...good, title: "Ledusskapji no 199 €" }, ctx)).toContain(
      "number 199 is not in the data",
    );
    expect(checkSeoText({ title: " ", description: " " }, ctx)).toEqual(
      expect.arrayContaining(["empty title", "empty description"]),
    );
  });
});

describe("trialVerdict", () => {
  const before = { impressions: 400, clicks: 8, position: 8 };
  it("keeps a change that did no harm, takes back one that lost clicks, and waits for enough data", () => {
    expect(trialVerdict(before, { impressions: 300, clicks: 9, position: 8 })).toBe("keep");
    expect(trialVerdict(before, { impressions: 300, clicks: 6, position: 8 })).toBe("keep");
    expect(trialVerdict(before, { impressions: 300, clicks: 2, position: 8 })).toBe("revert");
    expect(trialVerdict(before, { impressions: 20, clicks: 0, position: 8 })).toBe("wait");
    // Fewer clicks per view, but the page moved up three places: more people see it now.
    expect(trialVerdict(before, { impressions: 900, clicks: 10, position: 5 })).toBe("keep");
    expect(
      trialVerdict({ impressions: 0, clicks: 0, position: 9 }, { impressions: 50, clicks: 0, position: 9 }),
    ).toBe("keep");
  });
});
