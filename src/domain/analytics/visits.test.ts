import { describe, expect, it } from "vitest";
import { isBot, rigaDay, visitOf, visitorHash } from "./visits";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

describe("visitOf", () => {
  it("records pages with their section and category, never the answers", () => {
    expect(visitOf("/rezultati?sub=fridge&a=secret", UA)).toEqual({
      path: "/rezultati",
      section: "results",
      subcategory: "fridge",
    });
    expect(visitOf("/izvelies/cool/fridge", UA)).toMatchObject({ section: "choose", subcategory: "fridge" });
    expect(visitOf("/piedavajums/abc", UA)).toMatchObject({ section: "offer" });
  });
  it("skips bots, the admin, APIs, files and payment redirects", () => {
    expect(visitOf("/", "Googlebot/2.1")).toBeNull();
    expect(visitOf("/", null)).toBeNull();
    expect(visitOf("/admin/statistika", UA)).toBeNull();
    expect(visitOf("/api/visit", UA)).toBeNull();
    expect(visitOf("/og.png", UA)).toBeNull();
    expect(visitOf("/go/123", UA)).toBeNull();
    expect(visitOf("/" + "a".repeat(250), UA)).toBeNull();
  });
  it("knows common bots and headless browsers", () => {
    expect(isBot("Mozilla/5.0 HeadlessChrome/120")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot(UA)).toBe(false);
  });
});

describe("visitorHash", () => {
  it("is stable within a day and different with another salt", () => {
    const a = visitorHash("salt-1", "1.2.3.4", UA);
    expect(a).toHaveLength(32);
    expect(visitorHash("salt-1", "1.2.3.4", UA)).toBe(a);
    expect(visitorHash("salt-2", "1.2.3.4", UA)).not.toBe(a);
  });
  it("counts the day in Riga", () => {
    expect(rigaDay(new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-25");
  });
});
