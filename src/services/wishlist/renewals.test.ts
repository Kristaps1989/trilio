import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { accounts, savedItems, users } from "@/db/schema";
import { alertsUntilFrom } from "@/domain/notify/notify";
import { itemsForEvaluation } from "@/db/queries/wishlist";
import { memoryEmailSender } from "@/services/notify/email";
import { renewalTexts } from "@/services/texts";
import { renewAlertsByToken, runAlertRenewals, unsubscribeAlerts } from "./alerts";

// Price e-mails run 90 days (owner, 9 Nov 2026; docs/ALERTS_WITHOUT_CONFIRM_PLAN.md):
// 7 days before the end one e-mail asks whether to continue; unrenewed, an unproven
// address's request is deleted, a proven account keeps its wishlist without e-mails.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const DOMAIN = "renewals-test.invalid";
const BASE = "https://trilio.test";
const DAY = 24 * 3600 * 1000;

run("price e-mails' 90 days", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const mail = memoryEmailSender();
  // The real clock, with each item's end set around it, so no other test's items are touched.
  const now = new Date();
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  const deps = (now: Date) => ({
    email: mail,
    baseUrl: BASE,
    company: "SIA Trilio",
    texts: renewalTexts,
    now,
  });

  async function person(name: string, ends: Date, opts: { proven?: "verified" | "google" } = {}) {
    const [u] = await db
      .insert(users)
      .values({
        email: `${name}@${DOMAIN}`,
        emailVerified: opts.proven === "verified" ? now : null,
        alertsToken: `${name}-renewals-token-abcdefghijklmnop`,
      })
      .returning();
    if (opts.proven === "google")
      await db
        .insert(accounts)
        .values({ userId: u!.id, type: "oidc", provider: "google", providerAccountId: `g-${name}` });
    await db.insert(savedItems).values({
      userId: u!.id,
      kind: "search",
      key: `s:kettle:${name}`,
      subcategoryId: "kettle",
      answersParam: "",
      label: `Tējkannas ${name}`,
      baselinePriceCents: 3000,
      alertsUntil: ends,
    });
    return u!;
  }

  async function cleanup() {
    const people = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%@${DOMAIN}`));
    if (people.length)
      await db.delete(users).where(
        inArray(
          users.id,
          people.map((p) => p.id),
        ),
      );
  }

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await end();
  });

  it("asks once, 7 days before the end, and the link renews for 90 days", async () => {
    // Eight days left: nothing yet.
    const ann = await person("ann", at(8));
    await runAlertRenewals(db, deps(now));
    expect(mail.sent.filter((m) => m.to === ann.email)).toHaveLength(0);
    // Six days left: one e-mail each, saying what happens if nothing is done.
    await db
      .update(savedItems)
      .set({ alertsUntil: at(6) })
      .where(eq(savedItems.userId, ann.id));
    const bob = await person("bob", at(6), { proven: "verified" });
    const r = await runAlertRenewals(db, deps(now));
    expect(r.asked).toBeGreaterThanOrEqual(2);
    const annMail = mail.sent.find((m) => m.to === ann.email)!;
    expect(annMail.subject).toBe("Vai turpināt sekot cenai?");
    expect(annMail.text).toContain("Tējkannas ann");
    expect(annMail.text).toContain(`${BASE}/velmju-saraksts/turpinat/ann-renewals-token`);
    expect(annMail.text).toContain("pieprasījumu dzēsīsim");
    expect(annMail.headers?.["List-Unsubscribe"]).toContain("/api/wishlist/unsubscribe/ann-renewals-token");
    const bobMail = mail.sent.find((m) => m.to === bob.email)!;
    expect(bobMail.text).toContain("vēlmju sarakstā tās paliks");
    // Once only.
    await runAlertRenewals(db, deps(at(1)));
    expect(mail.sent.filter((m) => m.to === ann.email)).toHaveLength(1);
    // Ann continues: 90 days from the click.
    const until = await renewAlertsByToken(db, ann.alertsToken!, at(2));
    expect(until?.toISOString()).toBe(at(92).toISOString());
    const [item] = await db.select().from(savedItems).where(eq(savedItems.userId, ann.id));
    expect(item!.alertsUntil.toISOString()).toBe(at(92).toISOString());
    expect(item!.renewalSentAt).toBeNull();
    expect(await renewAlertsByToken(db, "x".repeat(40), at(2))).toBeNull();
  });

  it("unrenewed, an unproven request is deleted with its account; a proven one keeps the wishlist, without e-mails", async () => {
    // Ended yesterday, unrenewed.
    const cat = await person("cat", at(-1));
    const dan = await person("dan", at(-1), { proven: "google" });
    const r = await runAlertRenewals(db, deps(now));
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(r.usersDeleted).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(users).where(eq(users.id, cat.id))).toEqual([]);
    // Dan (Google) keeps his saved item; its e-mails have stopped.
    expect(await db.select().from(savedItems).where(eq(savedItems.userId, dan.id))).toHaveLength(1);
    const evaluated = await itemsForEvaluation(db, now);
    expect(evaluated.some((e) => e.item.userId === dan.id)).toBe(false);
    // Ann renewed, so she is still followed.
    expect(evaluated.some((e) => e.item.label === "Tējkannas ann")).toBe(true);
  });

  it("the unsubscribe stops everything for an unproven address, and only the e-mails for a proven one", async () => {
    const eve = await person("eve", at(60));
    const fay = await person("fay", at(60), { proven: "verified" });
    expect(await unsubscribeAlerts(db, eve.alertsToken!)).toBe("request");
    expect(await db.select().from(savedItems).where(eq(savedItems.userId, eve.id))).toEqual([]);
    const [e] = await db.select().from(users).where(eq(users.id, eve.id));
    expect(e).toMatchObject({ priceAlerts: false, offersOptIn: false });
    expect(await unsubscribeAlerts(db, fay.alertsToken!)).toBe("alerts");
    expect(await db.select().from(savedItems).where(eq(savedItems.userId, fay.id))).toHaveLength(1);
    expect(await unsubscribeAlerts(db, "nope")).toBeNull();
  });
});
