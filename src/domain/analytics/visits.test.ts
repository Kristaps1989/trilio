import { describe, expect, it } from "vitest";
import { clientFamily, isBot, rigaDay, visitOf, visitorHash } from "./visits";

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

describe("clientFamily", () => {
  it("names the browser family and system, nothing finer", () => {
    expect(
      clientFamily(
        "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome Android");
    expect(
      clientFamily(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari iOS");
    expect(
      clientFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      ),
    ).toBe("Edge Windows");
    expect(
      clientFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0"),
    ).toBe("Firefox macOS");
    expect(
      clientFamily(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Samsung Internet Android");
    expect(clientFamily(null)).toBe("Cits cita sistēma");
  });
  it("recognises the crawlers that stay out of the statistics", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "AdsBot-Google (+http://www.google.com/adsbot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    ])
      expect(isBot(ua)).toBe(true);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36")).toBe(false);
  });
});
