import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  notifyRequests,
  offerEvents,
  partnerRequests,
  products,
  requestOutcomes,
  savedItems,
  specialOffers,
  stores,
  users,
} from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { upsertOffers } from "@/services/ingestion/upsert";
import { memoryEmailSender } from "@/services/notify/email";
import { leadItems, offerItems } from "./crm";
import {
  answerAsk,
  declineAlternative,
  markMonitoringOnly,
  markNothing,
  minMarginPct,
  nothingSuggestion,
  offerAlternative,
  requestersOf,
  setMinMarginPct,
  waitForPartner,
  type AlternativeInput,
} from "./outcomes";
import { setFlag } from "./audit";

// Answering every price request (docs/ALTERNATIVE_OFFER_PLAN.md): who asked and
// what each was answered, an alternative sent directly or asked about first, the
// "Jā / Nē", "Gribu tikai pieprasīto modeli", nothing to offer, monitoring only.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const DAY = 24 * 3600 * 1000;
const BASE = "https://trilio.test";
const PREFIX = "outcomes-test-";
const ean = (n: string) => `99000000${n}` + gtinCheckDigit(`99000000${n}`);
const EANS = { orig: ean("1201"), alt: ean("1202"), worse: ean("1203"), cheap: ean("1204") };

run("answers to price requests", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const mail = memoryEmailSender();
  const deps = { email: mail, baseUrl: BASE, signature: "Kristaps", inbox: "info@trilio.test" };
  const stamp = Date.now();
  const address = (n: string) => `${PREFIX}${n}-${stamp}@example.invalid`;
  const ids: Record<keyof typeof EANS, string> = { orig: "", alt: "", worse: "", cheap: "" };
  const people: Record<string, string> = {};
  let emailOnly = "";

  async function cleanup() {
    const prods = await db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.ean, Object.values(EANS)));
    const pids = prods.map((p) => p.id);
    if (pids.length) {
      const offers = await db
        .select({ id: specialOffers.id })
        .from(specialOffers)
        .where(inArray(specialOffers.productId, pids));
      const oids = offers.map((o) => o.id);
      if (oids.length) {
        await db.delete(requestOutcomes).where(inArray(requestOutcomes.offerId, oids));
        await db.delete(offerEvents).where(inArray(offerEvents.offerId, oids));
        await db.delete(specialOffers).where(inArray(specialOffers.id, oids));
      }
      await db.delete(requestOutcomes).where(inArray(requestOutcomes.productId, pids));
      await db.delete(partnerRequests).where(inArray(partnerRequests.productId, pids));
    }
    await db.delete(notifyRequests).where(like(notifyRequests.email, `${PREFIX}%`));
    await db.delete(users).where(like(users.email, `${PREFIX}%`));
    if (pids.length) await db.delete(products).where(inArray(products.id, pids));
    await db.delete(stores).where(eq(stores.slug, "outcomes_test_store"));
  }

  const person = async (
    n: string,
    optIn: boolean,
    product: string,
    consent: string | null,
    seen = 60_000,
  ) => {
    const [u] = await db
      .insert(users)
      .values({ email: address(n), offersOptIn: optIn, locale: "lv" })
      .returning();
    await db.insert(savedItems).values({
      userId: u!.id,
      kind: "product",
      key: `p:${product}`,
      productId: product,
      subcategoryId: "washer",
      baselinePriceCents: seen,
    });
    if (consent)
      await db.insert(notifyRequests).values({
        token: `${PREFIX}${n}-${stamp}-token-abcdefghij`,
        email: address(n),
        kind: "product",
        productId: product,
        subcategoryId: "washer",
        locale: "lv",
        consent,
        offers: true,
        userId: u!.id,
        activatedAt: new Date(),
      });
    people[n] = u!.id;
    return u!.id;
  };

  const alternative = (over: Partial<AlternativeInput> = {}): AlternativeInput => ({
    originalId: ids.orig,
    alternativeId: ids.alt,
    manual: null,
    priceCents: 55_000,
    costCents: 50_000,
    condition: "new",
    grade: null,
    warrantyMonths: 24,
    deliveryWorkingDays: 3,
    validUntil: new Date(Date.now() + 7 * DAY),
    message: null,
    supplierNote: null,
    description: "Klusa, ar tvaika programmu.",
    imageSetId: null,
    ...over,
  });

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
    const [s] = await db
      .insert(stores)
      .values({ slug: "outcomes_test_store", displayName: "Outcomes Store", feedType: "sample" })
      .returning();
    const row = (e: string, brand: string, price: number, attributes: Record<string, unknown>) => ({
      externalId: `oc-${e}`,
      ean: e,
      brand,
      modelCode: `${brand.slice(0, 2).toUpperCase()}-${e.slice(-4)}`,
      name: `${brand} veļas mašīna ${e.slice(-4)}`,
      description: null,
      subcategoryId: "washer",
      attributes,
      tags: [],
      specs: null,
      kwhYear: null,
      rating: 80,
      imageUrl: null,
      condition: "new" as const,
      grade: null,
      warrantyMonths: null,
      priceCents: price,
      stock: "in" as const,
      deliveryEtaDays: null,
      url: `https://example.invalid/${e}`,
    });
    const base = { loading: "front", depth_cm: 55, height_cm: 85 };
    await upsertOffers(db, { id: s!.id }, [
      row(EANS.orig, "OrigBrandOc", 60_000, { ...base, capacity_kg: 8, noise_db: 72, energy_class: "B" }),
      row(EANS.alt, "AltBrandOc", 62_000, { ...base, capacity_kg: 9, noise_db: 72, energy_class: "A" }),
      row(EANS.worse, "WorseBrandOc", 58_000, { ...base, capacity_kg: 8, noise_db: 78, energy_class: "B" }),
      row(EANS.cheap, "CheapBrandOc", 45_000, { ...base, capacity_kg: 7 }),
    ]);
    const list = await db
      .select()
      .from(products)
      .where(inArray(products.ean, Object.values(EANS)));
    for (const k of Object.keys(EANS) as (keyof typeof EANS)[])
      ids[k] = list.find((p) => p.ean === EANS[k])!.id;
    // Direct: the request's text mentioned an alternative. Asked first: an older text. Monitoring: no offers.
    await person("direct", true, ids.orig, "notify.body@2026-11-16");
    await person("old", true, ids.orig, "notify.body@2026-11-09.2", 61_000);
    await person("plain", false, ids.orig, null);
    const [r] = await db
      .insert(notifyRequests)
      .values({
        token: `${PREFIX}mailonly-${stamp}-token-abcdefghij`,
        email: address("mailonly"),
        kind: "product",
        productId: ids.orig,
        subcategoryId: "washer",
        locale: "lv",
        consent: "notify.body@2026-11-16",
        offers: true,
      })
      .returning();
    emailOnly = r!.id;
    await db.insert(partnerRequests).values({
      productId: ids.orig,
      status: "unavailable",
      partner: "Distributor A",
      createdBy: "admin@test",
    });
  });

  afterAll(async () => {
    await cleanup();
    await end();
  });

  it("lists who asked, each with an answer chip and whether an alternative may go directly", async () => {
    const list = await requestersOf(db, ids.orig);
    const by = (k: string) => list.find((r) => r.key === k)!;
    expect(by(`u:${people.direct}`)).toMatchObject({ chip: "new", direct: true, wantsOffers: true });
    expect(by(`u:${people.old}`)).toMatchObject({ chip: "new", direct: false, seenCents: 61_000 });
    expect(by(`u:${people.plain}`)).toMatchObject({ chip: "monitoring_only", wantsOffers: false });
    expect(by(`r:${emailOnly}`)).toMatchObject({ chip: "new", direct: true, userId: null });
  });

  it("puts an unavailable product with people waiting at the top: decide", async () => {
    const lead = (await leadItems(db)).find((l) => l.id === ids.orig);
    expect(lead).toMatchObject({ stage: "unavailable", state: "action", next: "decide_unavailable" });
    expect(lead?.savers?.undecided).toBe(3);
  });

  it("refuses an alternative that does not beat its shop price or costs more than the original seen", async () => {
    expect(await offerAlternative(db, alternative({ priceCents: 62_000 }), "admin@test", deps)).toEqual({
      ok: false,
      reason: "price",
      problems: ["not_below_shop", "above_original"],
    });
    expect(await offerAlternative(db, alternative({ priceCents: 61_000 }), "admin@test", deps)).toEqual({
      ok: false,
      reason: "price",
      problems: ["above_original"],
    });
    const above = await offerAlternative(
      db,
      alternative({ alternativeId: ids.worse, priceCents: 57_000, keys: [`u:${people.direct}`] }),
      "admin@test",
      { ...deps },
    );
    expect(above).toEqual({ ok: true, sent: 1, asked: 0, skipped: 0 });
  });

  it("sends the alternative directly where the text allowed it, and asks the others first", async () => {
    // The earlier call answered "direct"; the rest still wait.
    const before = mail.sent.length;
    const res = await offerAlternative(db, alternative(), "admin@test", deps);
    expect(res).toEqual({ ok: true, sent: 1, asked: 1, skipped: 0 });
    const sent = mail.sent.slice(before);
    const direct = sent.find((m) => m.to === address("mailonly"))!;
    expect(direct.subject).toMatch(/nav pieejams — varam piedāvāt/);
    expect(direct.html).toContain("Tu prasīji");
    expect(direct.html).toContain("Labāk");
    expect(direct.html).toContain("Trilio apraksts");
    expect(direct.text).toContain("Gribu tikai pieprasīto modeli");
    const ask = sent.find((m) => m.to === address("old"))!;
    expect(ask.subject).toMatch(/Piedāvāt līdzvērtīgu\?/);
    expect(ask.text).toMatch(/atbilde=ja/);
    // The held draft is the shopper's turn, not a task to send.
    const held = (await offerItems(db)).find((o) => o.person === address("old"));
    expect(held).toMatchObject({ stage: "held", state: "waiting", next: null });
    const chips = (await requestersOf(db, ids.orig)).map((r) => [r.key, r.chip]);
    expect(chips).toEqual(
      expect.arrayContaining([
        [`u:${people.direct}`, "alternative_offered"],
        [`u:${people.old}`, "alternative_asked"],
        [`r:${emailOnly}`, "alternative_offered"],
      ]),
    );
  });

  it("a worse alternative says similar and names the downside", async () => {
    const msg = mail.sent.find((m) => m.to === address("direct"))!;
    expect(msg.subject).toMatch(/WorseBrandOc/);
    expect(msg.html).toContain("Sliktāk");
    expect(msg.text).toMatch(/trokšņa|troksn/i);
  });

  it("Jā sends the held offer once; answering again changes nothing", async () => {
    const [row] = await db.select().from(requestOutcomes).where(eq(requestOutcomes.userId, people.old!));
    const before = mail.sent.length;
    const yes = await answerAsk(db, row!.token, "yes", deps);
    expect(yes).toMatchObject({ ok: true, answer: "yes" });
    expect(mail.sent.length).toBe(before + 1);
    expect(mail.sent.at(-1)!.to).toBe(address("old"));
    expect(await answerAsk(db, row!.token, "no", deps)).toMatchObject({ ok: true, answer: "yes" });
    expect(mail.sent.length).toBe(before + 1);
  });

  it("Gribu tikai pieprasīto modeli withdraws the alternative and keeps the answer", async () => {
    const [offer] = await db.select().from(specialOffers).where(eq(specialOffers.notifyRequestId, emailOnly));
    expect(await declineAlternative(db, offer!.token)).toBe(true);
    expect(await declineAlternative(db, offer!.token)).toBe(false);
    const [after] = await db.select().from(specialOffers).where(eq(specialOffers.id, offer!.id));
    expect(after).toMatchObject({ status: "cancelled" });
    expect(after!.declinedAt).not.toBeNull();
    const [o] = await db.select().from(requestOutcomes).where(eq(requestOutcomes.offerId, offer!.id));
    expect(o).toMatchObject({ answer: "no" });
  });

  it("nothing to offer: one short e-mail per person, never twice, and monitoring goes on", async () => {
    const cheapUser = await person("nothing", true, ids.cheap, "notify.body@2026-11-16", 45_000);
    void cheapUser;
    // 450 € washer: worth asking. Nobody answered yet.
    const before = mail.sent.length;
    const first = await markNothing(
      db,
      { productId: ids.cheap, reason: "partner_not_cheaper", note: null, notify: true },
      "admin@test",
      deps,
    );
    expect(first).toEqual({ marked: 1, emailed: 1 });
    const msg = mail.sent.at(-1)!;
    expect(msg.subject).toMatch(/šobrīd nevaram piedāvāt lētāk/);
    expect(msg.text).toMatch(/Turpinām sekot cenai/);
    expect(msg.html).not.toMatch(/AltBrandOc|WorseBrandOc/);
    const again = await markNothing(
      db,
      { productId: ids.cheap, keys: [`u:${people.nothing}`], reason: "other", note: "vēlreiz", notify: true },
      "admin@test",
      deps,
    );
    expect(again).toEqual({ marked: 1, emailed: 0 });
    expect(mail.sent.length).toBe(before + 1);
    expect((await requestersOf(db, ids.cheap))[0]).toMatchObject({ chip: "nothing_to_offer" });
  });

  it("monitoring only records no e-mail", async () => {
    await person("monitor", true, ids.worse, "notify.body@2026-11-16", 58_000);
    const before = mail.sent.length;
    expect(await markMonitoringOnly(db, { productId: ids.worse }, "admin@test")).toBe(1);
    expect(mail.sent.length).toBe(before);
    expect((await requestersOf(db, ids.worse)).find((r) => r.userId === people.monitor)).toMatchObject({
      chip: "monitoring_only",
    });
  });

  it("Pagaidīt keeps the lead with the partner until the date", async () => {
    await person("waiter", true, ids.alt, "notify.body@2026-11-16", 62_000);
    await db.insert(partnerRequests).values({
      productId: ids.alt,
      status: "unavailable",
      partner: "Distributor B",
      createdBy: "admin@test",
    });
    expect(await waitForPartner(db, ids.alt, new Date(Date.now() + 7 * DAY), "admin@test")).toBe(true);
    const lead = (await leadItems(db)).find((l) => l.id === ids.alt);
    expect(lead).toMatchObject({ stage: "waiting", state: "partner" });
    expect(await waitForPartner(db, ids.alt, new Date(Date.now() - DAY), "admin@test")).toBe(false);
  });

  it("suggests nothing to offer when the partner's cost plus margin reaches the shops", async () => {
    await db.insert(partnerRequests).values({
      productId: ids.worse,
      status: "confirmed",
      partner: "Distributor C",
      costCents: 57_000,
      createdBy: "admin@test",
    });
    expect(await nothingSuggestion(db, ids.worse)).toBe("partner_not_cheaper");
    expect(await setMinMarginPct(db, 0)).toBe(true);
    expect(await minMarginPct(db)).toBe(0);
    expect(await nothingSuggestion(db, ids.worse)).toBeNull();
    expect(await setMinMarginPct(db, 99)).toBe(false);
    await setFlag(db, "offers.min_margin_pct", null);
    expect(await minMarginPct(db)).toBe(3);
  });

  it("refuses what it cannot do, and says why", async () => {
    expect(await answerAsk(db, "not-a-token", "yes", deps)).toEqual({ ok: false, reason: "unknown" });
    expect(await declineAlternative(db, "bad")).toBe(false);
    expect(await waitForPartner(db, ids.cheap, new Date(Date.now() + DAY), "admin@test")).toBe(false);
    expect(
      await markNothing(
        db,
        { productId: "00000000-0000-0000-0000-000000000000", reason: "other", note: null, notify: true },
        "admin@test",
        deps,
      ),
    ).toEqual({ marked: 0, emailed: 0 });
    expect(
      await offerAlternative(
        db,
        alternative({ originalId: "00000000-0000-0000-0000-000000000000" }),
        "a",
        deps,
      ),
    ).toEqual({
      ok: false,
      reason: "product",
    });
    expect(
      await offerAlternative(
        db,
        alternative({
          alternativeId: null,
          manual: { name: "", brand: "", modelCode: null, ean: null, attributes: {} },
        }),
        "a",
        deps,
      ),
    ).toEqual({ ok: false, reason: "manual" });
    // Everyone on the original has an answer now: nobody to send to.
    expect(await offerAlternative(db, alternative(), "a", deps)).toEqual({ ok: false, reason: "recipients" });
    await setFlag(db, "offers_paused", "1");
    expect(await offerAlternative(db, alternative(), "a", deps)).toEqual({ ok: false, reason: "paused" });
    await setFlag(db, "offers_paused", null);
    expect(await nothingSuggestion(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await requestersOf(db, "00000000-0000-0000-0000-000000000000")).toEqual([]);
  });
});
