import { describe, expect, it } from "vitest";
import { trilioSources } from "@/domain/offers/sourcing";
import {
  ALERT_DAYS,
  CONSENT_VERSION,
  activeOnRequest,
  alertPhase,
  alertsUntilFrom,
  MAX_PER_EMAIL_PER_DAY,
  MAX_PER_VISITOR_PER_DAY,
  REQUEST_TTL_MS,
  SIGN_IN_TTL_MS,
  consentFor,
  consentVersion,
  requestOfferable,
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
    // A search is a watch, never a request to a partner.
    expect(consentFor("search", true)).toEqual({
      key: `notify.bodySearch@${CONSENT_VERSION}`,
      offers: false,
    });
    expect(consentFor("search", false)).toEqual({
      key: `notify.bodySearch@${CONSENT_VERSION}`,
      offers: false,
    });
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

  it("Trilio sources every category; the file can narrow it or leave some out", () => {
    for (const sub of ["fridge", "kettle", "toaster"]) expect(trilioSources(sub)).toBe(true);
    expect(trilioSources("kettle", { sourcing: ["fridge"] })).toBe(false);
    expect(trilioSources("fridge", { sourcing: ["fridge"] })).toBe(true);
    expect(trilioSources("kettle", { sourcing: ["*"], except: ["kettle"] })).toBe(false);
  });
});

describe("a proposal without a confirmed address (docs/REQUEST_OFFER_PLAN.md)", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  const base = {
    kind: "product",
    offers: true,
    consent: "notify.body@2026-11-09",
    createdAt: new Date("2026-11-09T12:00:00Z"),
    confirmedAt: null,
  };
  it("is allowed for a product request whose text promised a proposal", () => {
    expect(requestOfferable(base, now)).toBe("ok");
    expect(consentVersion("notify.body@2026-11-09")).toBe("2026-11-09");
  });
  it("is refused when the text shown never said so, for searches and plain categories, once confirmed or expired", () => {
    expect(requestOfferable({ ...base, consent: "notify.body@2026-10-31" }, now)).toBe("old_text");
    expect(requestOfferable({ ...base, kind: "search" }, now)).toBe("search");
    expect(requestOfferable({ ...base, offers: false, consent: "notify.bodyPlain@2026-11-09" }, now)).toBe(
      "no_offers",
    );
    expect(requestOfferable({ ...base, confirmedAt: now }, now)).toBe("confirmed");
    expect(requestOfferable(base, new Date("2026-11-17T12:00:01Z"))).toBe("expired");
  });
});

describe("price e-mails run 90 days (docs/ALERTS_WITHOUT_CONFIRM_PLAN.md)", () => {
  const t0 = new Date("2026-11-09T12:00:00Z");
  const day = (n: number) => new Date(t0.getTime() + n * 24 * 3600 * 1000);
  it("starts at once from today's text, not from an older one", () => {
    expect(activeOnRequest(`notify.body@${CONSENT_VERSION}`)).toBe(true);
    expect(activeOnRequest("notify.body@2026-11-09")).toBe(false);
    expect(activeOnRequest("notify.bodySearch@2026-10-31")).toBe(false);
    expect(consentVersion("notify.body@2026-11-09.2")).toBe("2026-11-09.2");
  });
  it("is active, then asks once in the last 7 days, then ends", () => {
    const item = { alertsUntil: alertsUntilFrom(t0), renewalSentAt: null };
    expect(ALERT_DAYS).toBe(90);
    expect(alertPhase(item, day(82))).toBe("active");
    expect(alertPhase(item, day(84))).toBe("notice");
    expect(alertPhase({ ...item, renewalSentAt: day(84) }, day(85))).toBe("active");
    expect(alertPhase(item, day(90))).toBe("expired");
  });
});
