import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { isAdminEmail, adminEmails, offerSignature } from "@/config/admin";
import { eventful, runHousekeeping } from "./housekeeping";

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

describe("admin configuration", () => {
  it("reads ADMIN_EMAILS, case-insensitively; empty means nobody", () => {
    const env = { ADMIN_EMAILS: " Owner@Trilio.lv, bad, second@example.com " };
    expect(adminEmails(env)).toEqual(["owner@trilio.lv", "second@example.com"]);
    expect(isAdminEmail("OWNER@trilio.lv", env)).toBe(true);
    expect(isAdminEmail("someone@trilio.lv", env)).toBe(false);
    expect(isAdminEmail(null, env)).toBe(false);
    expect(adminEmails({})).toEqual([]);
    expect(offerSignature({ OFFERS_SENDER_NAME: " Kristaps " })).toBe("Kristaps");
    expect(offerSignature({})).toBe("Trilio");
  });
  it("calls a run eventful only when something happened", () => {
    const quiet = {
      visits: { days: 2, purged: 0 },
      offers: { expired: 0, reminded: 0, feedbackAsked: 0, tracked: 0, delivered: 0 },
      adLandingsPurged: 0,
      tvViewersPurged: 0,
      notifyRequestsPurged: 0,
      uiEventsPurged: 0,
    };
    expect(eventful(quiet)).toBe(false);
    expect(eventful({ ...quiet, offers: { ...quiet.offers, reminded: 1 } })).toBe(true);
    expect(eventful({ ...quiet, visits: { days: 0, purged: 3 } })).toBe(true);
    expect(eventful({ ...quiet, adLandingsPurged: 1 })).toBe(true);
    expect(eventful({ ...quiet, tvViewersPurged: 1 })).toBe(true);
    expect(eventful({ ...quiet, notifyRequestsPurged: 1 })).toBe(true);
    expect(eventful({ ...quiet, uiEventsPurged: 1 })).toBe(true);
  });
});

run("runHousekeeping", () => {
  const { db, client } = createDb(url);
  afterAll(() => client.end());
  it("runs the visit rollup and the offers job", async () => {
    const r = await runHousekeeping(db);
    expect(r.visits).toEqual(
      expect.objectContaining({ days: expect.any(Number), purged: expect.any(Number) }),
    );
    expect(Object.keys(r.offers).sort()).toEqual([
      "delivered",
      "expired",
      "feedbackAsked",
      "reminded",
      "tracked",
    ]);
  });
});
