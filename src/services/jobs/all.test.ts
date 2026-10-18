import { describe, expect, it } from "vitest";
import { isDue, runBudgetMinutes } from "./all";

const scrape = { feedType: "scrape" as const, scrapeConfig: { maxRunMinutes: 90 } };
const feed = { feedType: "google_xml" as const, scrapeConfig: null };
const now = new Date("2026-10-18T18:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("isDue (each shop on its own schedule)", () => {
  it("is due when the shop never ran", () => {
    expect(isDue(scrape, [], now)).toBe(true);
  });
  it("waits four hours after the last finished run", () => {
    expect(isDue(scrape, [{ startedAt: ago(200), finishedAt: ago(120) }], now)).toBe(false);
    expect(isDue(scrape, [{ startedAt: ago(400), finishedAt: ago(241) }], now)).toBe(true);
  });
  it("is not due while a run is alive (within budget + slack)", () => {
    expect(isDue(scrape, [{ startedAt: ago(60), finishedAt: null }], now)).toBe(false);
  });
  it("treats an unfinished run older than its budget as dead", () => {
    // 90 min budget + 15 min slack: a run started 2 h ago without finishing died (redeploy, crash).
    expect(isDue(scrape, [{ startedAt: ago(120), finishedAt: null }], now)).toBe(true);
  });
  it("one shop's recent run does not hold another back (runs are per store)", () => {
    expect(isDue(feed, [], now)).toBe(true);
  });
  it("uses the store's own time budget", () => {
    expect(runBudgetMinutes(scrape)).toBe(90);
    expect(runBudgetMinutes({ feedType: "scrape", scrapeConfig: { maxRunMinutes: 100 } })).toBe(100);
    expect(runBudgetMinutes(feed)).toBe(30);
  });
});
