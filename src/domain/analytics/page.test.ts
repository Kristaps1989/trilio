import { describe, expect, it } from "vitest";
import { clickLabel, eventFromDataset, pageInfo } from "./page";

describe("pageInfo", () => {
  it("maps sections and finds the subcategory in the path or query", () => {
    expect(pageInfo("/")).toEqual({ path: "/", section: "home", subcategory: undefined });
    expect(pageInfo("/izvelies/cool/fridge")).toEqual({
      path: "/izvelies/cool/fridge",
      section: "choose",
      subcategory: "fridge",
    });
    expect(pageInfo("/kategorija/washer/lidz-500").subcategory).toBe("washer");
    expect(pageInfo("/rezultati", "?sub=dish&a=eyJ4IjoxfQ")).toEqual({
      path: "/rezultati",
      section: "results",
      subcategory: "dish",
    });
    expect(pageInfo("/radars/jauns", "?sub=kettle").section).toBe("radar");
    expect(pageInfo("/privatums").section).toBe("legal");
    expect(pageInfo("/something/else").section).toBe("other");
  });

  it("never passes free text or odd values through", () => {
    expect(pageInfo("/cits", "?text=mans%20t%C4%81lrunis%2020000000")).toEqual({
      path: "/cits",
      section: "free_text",
      subcategory: undefined,
    });
    expect(pageInfo("/rezultati", "?sub=<script>").subcategory).toBeUndefined();
  });
});

describe("eventFromDataset", () => {
  it("builds an event with snake_case params", () => {
    expect(
      eventFromDataset({ gaEvent: "select_offer", gaParamStore: "Tet", gaParamPriceEur: "219", other: "x" }),
    ).toEqual({ event: "select_offer", params: { store: "Tet", price_eur: "219" } });
  });

  it("rejects missing or malformed event names", () => {
    expect(eventFromDataset({})).toBeNull();
    expect(eventFromDataset({ gaEvent: "Bad Name" })).toBeNull();
  });
});

describe("clickLabel", () => {
  it("prefers an explicit label, collapses whitespace and truncates", () => {
    expect(clickLabel("  Pirkt \n veikalā  ")).toBe("Pirkt veikalā");
    expect(clickLabel("text", "explicit")).toBe("explicit");
    expect(clickLabel("x".repeat(80))).toHaveLength(60);
    expect(clickLabel(null)).toBe("");
  });
});
