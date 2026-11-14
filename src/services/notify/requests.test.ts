import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { notifyRequests, uiEvents, users, products, visits } from "@/db/schema";
import { memoryEmailSender } from "@/services/notify/email";
import { CONSENT_VERSION } from "@/domain/notify/notify";
import { notifyFunnel, purgeUiEvents, askWhyCounts } from "./events";
import {
  confirmNotify,
  notifySignIn,
  purgeNotifyRequests,
  requestByToken,
  requestNotify,
  type NotifyTarget,
} from "./requests";

// "Iegūt lētāk" without an account (docs/ALERTS_WITHOUT_CONFIRM_PLAN.md): entering the
// e-mail is the consent, so the request makes the account (address not proven), saves the
// item and starts the e-mails at once; the receipt carries an unsubscribe; its link
// proves the address, turns price e-mails back on and signs in once.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const BASE = "https://trilio.test";
const DOMAIN = "notify-test.invalid";

run("notify requests", () => {
  let db: Db;
  let end: () => Promise<void>;
  const mail = memoryEmailSender();
  const saves: string[] = [];
  const save = async (userId: string) => {
    saves.push(userId);
    return true;
  };
  const deps = { email: mail, baseUrl: BASE, company: "SIA Trilio", save };
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
  /** Any seeded product: only a product is a request to a partner, so only it carries the offers consent. */
  async function productTarget(): Promise<NotifyTarget> {
    const [p] = await db
      .select({ id: products.id, name: products.name, subcategoryId: products.subcategoryId })
      .from(products)
      .limit(1);
    return {
      kind: "product",
      productId: p!.id,
      subcategoryId: p!.subcategoryId,
      name: p!.name,
      priceCents: null,
      imageUrl: null,
    };
  }
  async function cleanup() {
    await db.delete(notifyRequests).where(like(notifyRequests.email, `%@${DOMAIN}`));
    await db.delete(users).where(like(users.email, `%@${DOMAIN}`));
    await db.delete(uiEvents).where(like(uiEvents.visitorHash, "notify-test-%"));
    await db.delete(visits).where(like(visits.visitorHash, "notify-test-%"));
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

  it("starts at once: the account for the address, the item saved, one receipt with an unsubscribe", async () => {
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
    // A search is a watch, so its e-mail promises the price e-mail only.
    expect(m.subject).toBe("Sekosim cenai: Ledusskapji · 181–205 cm");
    expect(m.text).toContain(`${BASE}/pazinot/`);
    expect(m.text).toContain("Cenai sekosim 90 dienas");
    expect(m.text).toMatch(new RegExp(`Atteikties: ${BASE}/velmju-saraksts/atteikties/[A-Za-z0-9_-]+`));
    expect(m.headers?.["List-Unsubscribe"]).toMatch(new RegExp(`^<${BASE}/api/wishlist/unsubscribe/`));
    expect(m.html).toContain(`${BASE}/email/logo.png`);
    const stored = (await requestByToken(db, tokenOf()))!;
    expect(stored).toMatchObject({
      consent: `notify.bodySearch@${CONSENT_VERSION}`,
      offers: false,
      confirmedAt: null,
    });
    expect(stored.activatedAt).not.toBeNull();
    // The account exists, its address not proven, the item saved, e-mails on.
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, `anna@${DOMAIN}`));
    expect(u).toMatchObject({ priceAlerts: true, offersOptIn: false, emailVerified: null });
    expect(stored.userId).toBe(u!.id);
    expect(saves).toContain(u!.id);
  });

  it("every category is a sourcing one by default: a product's consent covers Trilio's offers too", async () => {
    await requestNotify(
      db,
      {
        email: `jon@${DOMAIN}`,
        target: await productTarget(),
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      deps,
    );
    expect(await requestByToken(db, tokenOf())).toMatchObject({
      offers: true,
      consent: `notify.body@${CONSENT_VERSION}`,
    });
    // The request is received and running: a proposal, and the price followed.
    expect(mail.sent.at(-1)!.subject).toMatch(/^Pieprasījums saņemts: /);
    expect(mail.sent.at(-1)!.text).toContain("Sekosim arī cenai");
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, `jon@${DOMAIN}`));
    expect(u).toMatchObject({ priceAlerts: true, offersOptIn: true });
  });

  it("a product under 200 € is a plain price alert: its consent does not cover Trilio's offers", async () => {
    await requestNotify(
      db,
      {
        email: `cheap@${DOMAIN}`,
        target: { ...(await productTarget()), priceCents: 4_900 } as NotifyTarget,
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      deps,
    );
    expect(await requestByToken(db, tokenOf())).toMatchObject({
      offers: false,
      consent: `notify.bodyPlain@${CONSENT_VERSION}`,
    });
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, `cheap@${DOMAIN}`));
    expect(u).toMatchObject({ priceAlerts: true, offersOptIn: false });
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
      consent: `notify.bodySearch@${CONSENT_VERSION}`,
      returnPath: null,
      locale: "en",
    });
    expect(mail.sent.at(-1)!.subject).toBe("We'll follow the price: Tējkannas");
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

  it("an e-mail service error is reported; what started keeps its unsubscribe", async () => {
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
  });

  it("the click proves the address, turns both e-mails on, and signs in once", async () => {
    await requestNotify(
      db,
      {
        email: `fia@${DOMAIN}`,
        target: await productTarget(),
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
    // Confirming again is harmless and does not save again.
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

  it("an address that already has an account goes into it, and a switch it turned off stays off", async () => {
    const [existing] = await db
      .insert(users)
      .values({ email: `ida@${DOMAIN}`, priceAlerts: false, offersAskedAt: new Date(), offersOptIn: false })
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
    expect((await requestByToken(db, tokenOf()))!.userId).toBe(existing!.id);
    expect(mail.sent.at(-1)!.text).toContain("Cenu e-pastus šai adresei iepriekš izslēdzi");
    const [before] = await db.select().from(users).where(eq(users.id, existing!.id));
    expect(before).toMatchObject({ priceAlerts: false, offersOptIn: false });
    // The button turns them back on: that click is the person's own.
    const c = await confirmNotify(db, tokenOf(), save);
    expect((c as { userId: string }).userId).toBe(existing!.id);
    const [after] = await db.select().from(users).where(eq(users.id, existing!.id));
    expect(after!.priceAlerts).toBe(true);
  });

  it("a request whose item cannot be saved leaves no account behind", async () => {
    const r = await requestNotify(
      db,
      {
        email: `gone@${DOMAIN}`,
        target: kettle,
        returnPath: "/",
        locale: "lv",
        visitorHash: null,
        adLandingId: null,
      },
      { ...deps, save: async () => false },
    );
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(
      await db
        .select()
        .from(users)
        .where(eq(users.email, `gone@${DOMAIN}`)),
    ).toHaveLength(0);
  });

  it("counts the funnel per category from first-party events", async () => {
    const day = "2026-10-30";
    await db.insert(uiEvents).values([
      { day, visitorHash: "notify-test-a", event: "notify_tap", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-a", event: "notify_tap", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-b", event: "notify_tap", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-a", event: "notify_sent", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-a", event: "notify_confirmed", subcategoryId: "fridge" },
      // The question before the shop: shown to two visitors, one went to the shop from it.
      { day, visitorHash: "notify-test-a", event: "ask_shown", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-b", event: "ask_shown", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-b", event: "ask_shop", subcategoryId: "fridge" },
      // A script opening "Pirkt" links straight (no page ever viewed): never counted.
      { day, visitorHash: "notify-test-script", event: "ask_shown", subcategoryId: "hob" },
      { day, visitorHash: "notify-test-script", event: "ask_shop", subcategoryId: "hob" },
    ]);
    // Both people viewed a page that day (the beacon); the script did not.
    await db.insert(visits).values([
      { day, path: "/rezultati", section: "results", subcategory: "fridge", visitorHash: "notify-test-a" },
      { day, path: "/rezultati", section: "results", subcategory: "fridge", visitorHash: "notify-test-b" },
    ]);
    // "Kas atturēja?": one answer per visitor and reason; an unknown reason is not counted.
    await db.insert(uiEvents).values([
      { day, visitorHash: "notify-test-a", event: "ask_why_slow", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-a", event: "ask_why_slow", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-b", event: "ask_why_trust", subcategoryId: "fridge" },
      { day, visitorHash: "notify-test-b", event: "ask_why_bogus", subcategoryId: "fridge" },
    ]);
    const why = await askWhyCounts(db, day, day);
    expect(why.slow).toBeGreaterThanOrEqual(1);
    expect(why.trust).toBeGreaterThanOrEqual(1);
    expect(Object.keys(why).sort()).toEqual(["later", "slow", "small", "trust"]);
    const rows = await notifyFunnel(db, day, day);
    const f = rows.find((r) => r.subcategoryId === "fridge")!;
    expect(f.taps).toBeGreaterThanOrEqual(2);
    expect(f.sent).toBeGreaterThanOrEqual(1);
    expect(f.confirmed).toBeGreaterThanOrEqual(1);
    expect(f.askShown).toBeGreaterThanOrEqual(2);
    expect(f.askShop).toBeGreaterThanOrEqual(1);
    const hob = rows.find((r) => r.subcategoryId === "hob");
    expect(hob?.askShown ?? 0).toBe(0);
    expect(hob?.askShop ?? 0).toBe(0);
  });

  it("housekeeping deletes requests that started nothing after 7 days, and old button events after 90", async () => {
    // A request under an older text, never confirmed: it promised nothing before the click.
    await db.insert(notifyRequests).values({
      token: `notify-old-text-${Date.now()}-abcdefghijk`,
      email: `old@${DOMAIN}`,
      kind: "search",
      subcategoryId: "kettle",
      label: "Tējkannas",
      locale: "lv",
      consent: "notify.bodySearch@2026-10-31",
      offers: false,
    });
    const later = new Date(Date.now() + 8 * 24 * 3600 * 1000);
    expect(await purgeNotifyRequests(db, later)).toBeGreaterThan(0);
    // The ones that started something stay as the record of that consent.
    const left = await db
      .select()
      .from(notifyRequests)
      .where(like(notifyRequests.email, `%@${DOMAIN}`));
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((r) => r.confirmedAt !== null || r.activatedAt !== null)).toBe(true);
    await db
      .insert(uiEvents)
      .values({ day: "2026-01-01", visitorHash: "notify-test-old", event: "notify_tap" });
    expect(await purgeUiEvents(db, new Date("2026-10-30T12:00:00Z"))).toBeGreaterThan(0);
  });
});
