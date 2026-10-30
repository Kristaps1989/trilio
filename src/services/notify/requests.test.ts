import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { notifyRequests, savedItems, uiEvents, users } from "@/db/schema";
import { memoryEmailSender } from "@/services/notify/email";
import { notifyFunnel, purgeUiEvents } from "./events";
import {
  confirmNotify,
  notifySignIn,
  purgeNotifyRequests,
  requestByToken,
  requestNotify,
  type NotifyTarget,
} from "./requests";

// Double opt-in without an account (docs/PRICE_NOTIFY_PLAN.md §5 PR 2): one
// e-mail to the typed address, nothing else until its link is clicked; the
// click makes the account, saves the item, turns the e-mails on and signs in once.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const BASE = "https://trilio.test";
const DOMAIN = "notify-test.invalid";

run("notify requests", () => {
  let db: Db;
  let end: () => Promise<void>;
  const mail = memoryEmailSender();
  const deps = { email: mail, baseUrl: BASE, company: "SIA Trilio" };
  // A file that narrows sourcing to fridges, to keep the price-e-mails-only path covered.
  const fridgesOnly = { ...deps, sourcing: { sourcing: ["fridge"] } };
  const fridge: NotifyTarget = {
    kind: "search",
    subcategoryId: "fridge",
    answersParam: "",
    label: "Ledusskapji · 181–205 cm",
  };
  const kettle: NotifyTarget = {
    kind: "search",
    subcategoryId: "kettle",
    answersParam: "",
    label: "Tējkannas",
  };
  const saves: string[] = [];
  const save = async (userId: string) => {
    saves.push(userId);
    return true;
  };

  async function cleanup() {
    await db.delete(notifyRequests).where(like(notifyRequests.email, `%@${DOMAIN}`));
    await db.delete(users).where(like(users.email, `%@${DOMAIN}`));
    await db.delete(uiEvents).where(like(uiEvents.visitorHash, "notify-test-%"));
  }

  beforeAll(async () => {
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await end();
  });

  const tokenOf = () => {
    const m = mail.sent.at(-1)!.text.match(/\/pazinot\/([A-Za-z0-9_-]+)/);
    return m![1]!;
  };

  it("sends one branded confirmation and stores the consent text shown", async () => {
    const r = await requestNotify(
      db,
      {
        email: ` Anna@${DOMAIN.toUpperCase()} `,
        target: fridge,
        returnPath: "/rezultati?sub=fridge",
        locale: "lv",
        visitorHash: "notify-test-v1",
        adLandingId: null,
      },
      deps,
    );
    expect(r).toMatchObject({ ok: true, email: `anna@${DOMAIN}` });
    const m = mail.sent.at(-1)!;
    expect(m.to).toBe(`anna@${DOMAIN}`);
    expect(m.subject).toBe("Apstiprini cenu paziņojumus: Ledusskapji · 181–205 cm");
    expect(m.text).toContain(`${BASE}/pazinot/`);
    expect(m.text).toContain("bez apstiprinājuma neko nesūtīsim");
    expect(m.html).toContain(`${BASE}/email/logo.png`);
    const stored = (await requestByToken(db, tokenOf()))!;
    expect(stored).toMatchObject({
      consent: "notify.bodySearch@2026-10-30",
      offers: true,
      confirmedAt: null,
    });
    // Nothing exists for that address yet: no account, nothing saved.
    expect(
      await db
        .select()
        .from(users)
        .where(eq(users.email, `anna@${DOMAIN}`)),
    ).toHaveLength(0);
  });

  it("every category is a sourcing one by default: a kettle's consent covers Trilio's offers too", async () => {
    await requestNotify(
      db,
      {
        email: `jon@${DOMAIN}`,
        target: kettle,
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      deps,
    );
    expect(await requestByToken(db, tokenOf())).toMatchObject({
      offers: true,
      consent: "notify.bodySearch@2026-10-30",
    });
  });

  it("where the file leaves a category out, the consent covers price e-mails only", async () => {
    await requestNotify(
      db,
      {
        email: `bruno@${DOMAIN}`,
        target: kettle,
        returnPath: "https://evil.test",
        locale: "en",
        visitorHash: null,
        adLandingId: null,
      },
      fridgesOnly,
    );
    const stored = (await requestByToken(db, tokenOf()))!;
    expect(stored).toMatchObject({
      offers: false,
      consent: "notify.bodySearchPlain@2026-10-30",
      returnPath: null,
      locale: "en",
    });
    expect(mail.sent.at(-1)!.subject).toBe("Confirm price e-mails: Tējkannas");
  });

  it("refuses a bad address and limits repeats", async () => {
    const ask = (email: string, visitorHash: string | null) =>
      requestNotify(
        db,
        { email, target: kettle, returnPath: "/", locale: "lv", visitorHash, adLandingId: null },
        deps,
      );
    expect(await ask("nav-epasts", null)).toEqual({ ok: false, reason: "invalid" });
    for (let i = 0; i < 3; i++) expect((await ask(`cara@${DOMAIN}`, null)).ok).toBe(true);
    expect(await ask(`cara@${DOMAIN}`, null)).toEqual({ ok: false, reason: "too_many" });
    for (let i = 0; i < 5; i++) expect((await ask(`d${i}@${DOMAIN}`, "notify-test-v2")).ok).toBe(true);
    expect(await ask(`d9@${DOMAIN}`, "notify-test-v2")).toEqual({ ok: false, reason: "too_many" });
  });

  it("an e-mail service error leaves no request behind", async () => {
    const failing = {
      ...deps,
      email: { send: async () => ({ ok: false as const, reason: "error" as const }) },
    };
    const r = await requestNotify(
      db,
      {
        email: `eve@${DOMAIN}`,
        target: kettle,
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      failing,
    );
    expect(r).toEqual({ ok: false, reason: "email_failed" });
    expect(
      await db
        .select()
        .from(notifyRequests)
        .where(eq(notifyRequests.email, `eve@${DOMAIN}`)),
    ).toHaveLength(0);
  });

  it("the click makes the account, saves, turns both e-mails on, and signs in once", async () => {
    await requestNotify(
      db,
      {
        email: `fia@${DOMAIN}`,
        target: fridge,
        returnPath: "/rezultati?sub=fridge",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      deps,
    );
    const value = tokenOf();
    expect(await notifySignIn(db, value)).toBeNull(); // not before confirming
    const c = await confirmNotify(db, value, save);
    expect(c.ok).toBe(true);
    const userId = (c as { userId: string }).userId;
    expect(saves).toContain(userId);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u).toMatchObject({ email: `fia@${DOMAIN}`, priceAlerts: true, offersOptIn: true });
    expect(u!.emailVerified).not.toBeNull();
    expect(u!.offersOptInAt).not.toBeNull();
    // Confirming again is harmless and does not save twice.
    const before = saves.length;
    expect((await confirmNotify(db, value, save)).ok).toBe(true);
    expect(saves.length).toBe(before);
    expect(await notifySignIn(db, value)).toMatchObject({ id: userId, email: `fia@${DOMAIN}` });
    expect(await notifySignIn(db, value)).toBeNull(); // once
  });

  it("outside sourcing, a confirmation leaves Trilio's offers off; an expired or unknown link does nothing", async () => {
    await requestNotify(
      db,
      {
        email: `gus@${DOMAIN}`,
        target: kettle,
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      fridgesOnly,
    );
    const value = tokenOf();
    const c = await confirmNotify(db, value, save);
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, (c as { userId: string }).userId));
    expect(u).toMatchObject({ priceAlerts: true, offersOptIn: false });
    expect((await confirmNotify(db, "x".repeat(43), save)).ok).toBe(false);
    await requestNotify(
      db,
      {
        email: `hal@${DOMAIN}`,
        target: kettle,
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      deps,
    );
    const late = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    expect((await confirmNotify(db, tokenOf(), save, late)).ok).toBe(false);
  });

  it("an address that already has an account confirms into it", async () => {
    const [existing] = await db
      .insert(users)
      .values({ email: `ida@${DOMAIN}` })
      .returning();
    await requestNotify(
      db,
      {
        email: `IDA@${DOMAIN}`,
        target: kettle,
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      deps,
    );
    const c = await confirmNotify(db, tokenOf(), save);
    expect((c as { userId: string }).userId).toBe(existing!.id);
  });

  it("counts the funnel per category from first-party events", async () => {
    const day = "2026-10-30";
    await db.insert(uiEvents).values([
      { day, visitorHash: "notify-test-a", event: "notify_tap", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-a", event: "notify_tap", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-b", event: "notify_tap", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-a", event: "notify_sent", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-a", event: "notify_confirmed", subcategoryId: "fridge" },
    ]);
    const rows = await notifyFunnel(db, day, day);
    const f = rows.find((r) => r.subcategoryId === "fridge")!;
    expect(f.taps).toBeGreaterThanOrEqual(2);
    expect(f.sent).toBeGreaterThanOrEqual(1);
    expect(f.confirmed).toBeGreaterThanOrEqual(1);
  });

  it("unconfirmed saves never happen: nothing is saved for a request nobody clicked", async () => {
    const pending = await db
      .select()
      .from(notifyRequests)
      .where(eq(notifyRequests.email, `anna@${DOMAIN}`));
    expect(pending[0]!.confirmedAt).toBeNull();
    expect(await db.select().from(savedItems).where(eq(savedItems.userId, pending[0]!.id))).toHaveLength(0);
  });

  it("housekeeping deletes unconfirmed requests after 7 days and old button events after 90", async () => {
    const later = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    expect(await purgeNotifyRequests(db, later)).toBeGreaterThan(0);
    // The confirmed ones stay with their accounts.
    const left = await db
      .select()
      .from(notifyRequests)
      .where(like(notifyRequests.email, `%@${DOMAIN}`));
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((r) => r.confirmedAt !== null)).toBe(true);
    await db
      .insert(uiEvents)
      .values({ day: "2026-01-01", visitorHash: "notify-test-old", event: "notify_tap" });
    expect(await purgeUiEvents(db, new Date("2026-10-30T12:00:00Z"))).toBeGreaterThan(0);
  });
});
