import { describe, expect, it } from "vitest";
import { trilioSources } from "@/domain/offers/sourcing";
import {
  CONSENT_VERSION,
  MAX_PER_EMAIL_PER_DAY,
  MAX_PER_VISITOR_PER_DAY,
  REQUEST_TTL_MS,
  SIGN_IN_TTL_MS,
  consentFor,
  normaliseEmail,
  rateLimit,
  requestState,
  safeReturnPath,
} from "./notify";

describe("notify rules", () => {
  it("accepts real addresses, lower-cased, and refuses the rest", () => {
    expect(normaliseEmail("  Anna.Berzina@Example.LV ")).toBe("anna.berzina@example.lv");
    for (const bad of [
      "",
      "anna",
      "anna@",
      "@x.lv",
      "a b@x.lv",
      "a@x",
      "<a@x.lv>",
      42,
      null,
      `${"a".repeat(250)}@x.lv`,
    ])
      expect(normaliseEmail(bad)).toBeNull();
  });

  it("names the text shown and covers Trilio's offers only where Trilio sources", () => {
    expect(consentFor("product", true)).toEqual({ key: `notify.body@${CONSENT_VERSION}`, offers: true });
    expect(consentFor("product", false)).toEqual({
      key: `notify.bodyPlain@${CONSENT_VERSION}`,
      offers: false,
    });
    expect(consentFor("search", true).key).toBe(`notify.bodySearch@${CONSENT_VERSION}`);
    expect(consentFor("search", false).key).toBe(`notify.bodySearchPlain@${CONSENT_VERSION}`);
  });

  it("returns only to a path on this site", () => {
    expect(safeReturnPath("/rezultati?sub=fridge")).toBe("/rezultati?sub=fridge");
    for (const bad of [
      "https://evil.test/",
      "//evil.test",
      "/\\evil.test",
      "rezultati",
      1,
      `/${"a".repeat(1000)}`,
    ])
      expect(safeReturnPath(bad)).toBeNull();
  });

  it("limits requests per visitor and per address", () => {
    expect(rateLimit({ visitor: 0, email: 0 })).toBe("ok");
    expect(rateLimit({ visitor: MAX_PER_VISITOR_PER_DAY, email: 0 })).toBe("too_many");
    expect(rateLimit({ visitor: 0, email: MAX_PER_EMAIL_PER_DAY })).toBe("too_many");
  });

  it("a link confirms for 7 days and signs in once, within 30 minutes of confirming", () => {
    const t0 = new Date("2026-10-30T10:00:00Z");
    const later = (ms: number) => new Date(t0.getTime() + ms);
    const fresh = { createdAt: t0, confirmedAt: null, signedInAt: null };
    expect(requestState(fresh, later(REQUEST_TTL_MS))).toEqual({ confirmable: true, canSignIn: false });
    expect(requestState(fresh, later(REQUEST_TTL_MS + 1)).confirmable).toBe(false);
    const confirmed = { createdAt: t0, confirmedAt: later(1000), signedInAt: null };
    expect(requestState(confirmed, later(REQUEST_TTL_MS * 2))).toEqual({
      confirmable: true,
      canSignIn: false,
    });
    expect(requestState(confirmed, later(1000 + SIGN_IN_TTL_MS)).canSignIn).toBe(true);
    expect(requestState({ ...confirmed, signedInAt: later(2000) }, later(3000)).canSignIn).toBe(false);
  });

  it("fridges are a sourcing category; the list can be swapped in tests", () => {
    expect(trilioSources("fridge")).toBe(true);
    expect(trilioSources("kettle")).toBe(false);
    expect(trilioSources("kettle", new Set(["kettle"]))).toBe(true);
  });
});
