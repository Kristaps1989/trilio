import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { waitlistLeads } from "@/db/schema";
import { purgeOldWaitlistLeads } from "./waitlist";

// Integration test against DATABASE_URL; rows are namespaced by e-mail.
const run = process.env.DATABASE_URL ? describe : describe.skip;

run("purgeOldWaitlistLeads", () => {
  let db: Db;
  let end: () => Promise<void>;
  const now = new Date("2027-06-01T00:00:00Z");

  beforeAll(async () => {
    const c = createDb();
    db = c.db;
    end = () => c.client.end();
    await db.delete(waitlistLeads).where(like(waitlistLeads.email, "purge-test-%"));
    await db.insert(waitlistLeads).values([
      { email: "purge-test-old@example.invalid", createdAt: new Date("2026-05-01T00:00:00Z") },
      { email: "purge-test-new@example.invalid", createdAt: new Date("2027-05-01T00:00:00Z") },
    ]);
  });

  afterAll(async () => {
    await db.delete(waitlistLeads).where(like(waitlistLeads.email, "purge-test-%"));
    await end();
  });

  it("deletes leads older than 12 months and keeps newer ones", async () => {
    expect(await purgeOldWaitlistLeads(db, now)).toBeGreaterThanOrEqual(1);
    const left = await db.select().from(waitlistLeads).where(like(waitlistLeads.email, "purge-test-%"));
    expect(left.map((r) => r.email)).toEqual(["purge-test-new@example.invalid"]);
  });
});
