import { describe, expect, it } from "vitest";
import { isUiLocale, localeOfPath, localizedPath, stripLocale } from "./routing";

describe("language in the path (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §4.1)", () => {
  it("adds /en for English and nothing for Latvian, keeping the query and hash", () => {
    expect(localizedPath("/izvelies", "en")).toBe("/en/izvelies");
    expect(localizedPath("/", "en")).toBe("/en");
    expect(localizedPath("/?a=1", "en")).toBe("/en?a=1");
    expect(localizedPath("/rezultati?sub=fridge#top", "en")).toBe("/en/rezultati?sub=fridge#top");
    expect(localizedPath("/izvelies", "lv")).toBe("/izvelies");
  });
  it("switches a path that already has a language", () => {
    expect(localizedPath("/en/konts", "lv")).toBe("/konts");
    expect(localizedPath("/en/konts", "en")).toBe("/en/konts");
    expect(localizedPath("/en", "lv")).toBe("/");
  });
  it("strips only a real /en segment", () => {
    expect(stripLocale("/en/izvelies?x=1")).toBe("/izvelies?x=1");
    expect(stripLocale("/en?x=1")).toBe("/?x=1");
    expect(stripLocale("/entertainment")).toBe("/entertainment");
  });
  it("tells the language of a path and validates locales", () => {
    expect(localeOfPath("/en")).toBe("en");
    expect(localeOfPath("/en/izvelies")).toBe("en");
    expect(localeOfPath("/en?x")).toBe("en");
    expect(localeOfPath("/izvelies")).toBe("lv");
    expect(localeOfPath("/entertainment")).toBe("lv");
    expect(isUiLocale("en")).toBe(true);
    expect(isUiLocale("lt")).toBe(false);
    expect(isUiLocale(undefined)).toBe(false);
  });
});
