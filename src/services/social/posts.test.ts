import { and, eq, gte, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { appFlags, offerOrders, socialInsights, socialPosts, specialOffers, visitDaily } from "@/db/schema";
import { leaks } from "@/domain/social/anonymise";
import { FIRST_CATEGORIES, rigaTime } from "@/domain/social/schedule";
import { mockPosts, mockSocialProvider } from "./mock";
import {
  approvePost,
  createPost,
  draftUpcoming,
  editCaptions,
  factsFor,
  publishDue,
  refresh,
  removePost,
  socialSettings,
  syncInsights,
  updateSocialSettings,
  type SocialDeps,
} from "./posts";
import { categoryLabel, picksFacts } from "./facts";
import { loadCandidates } from "@/db/queries/catalog";

// Posts against Postgres with the mock Meta (docs/SOCIAL_PLAN.md §7). The
// clock is set in 2031 so the test's slots never meet real ones.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const BASE = "https://trilio.test";
const FUTURE = new Date("2031-01-01T00:00:00Z");
const WED_MORNING = rigaTime("2031-01-08", 8); // Wednesday
const WED_SLOT = rigaTime("2031-01-08", 19);

run("social posts", () => {
  let db: Db;
  let end: () => Promise<void>;
  const deps: SocialDeps = { provider: mockSocialProvider(), baseUrl: BASE, caller: null };
  let firstAdvice = "";
  const personal = {
    fullName: "Līga Testa-Kalniņa",
    email: "liga.social-test@example.invalid",
    phone: "+371 2999 1234",
    street: "Testa iela 42",
  };

  async function cleanup() {
    await db.delete(socialPosts).where(gte(socialPosts.slotAt, FUTURE));
    await db.delete(socialPosts).where(eq(socialPosts.createdBy, "social-test"));
    await db.delete(offerOrders).where(eq(offerOrders.email, personal.email));
    await db.delete(specialOffers).where(eq(specialOffers.createdBy, "social-test"));
    await db.delete(visitDaily).where(like(visitDaily.path, "/social-test/%"));
  }

  beforeAll(async () => {
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
    await updateSocialSettings(db, { enabled: true, mode: "approve" });
  });

  afterAll(async () => {
    await cleanup();
    await db.delete(appFlags).where(like(appFlags.key, "social_%"));
    await end();
  });

  it("drafts Wednesday's slot a day ahead: advice from the knowledge base when no price dropped", async () => {
    expect(await draftUpcoming(db, deps, WED_MORNING)).toBe(1);
    const [p] = await db.select().from(socialPosts).where(eq(socialPosts.slotAt, WED_SLOT));
    expect(p).toMatchObject({ kind: "advice", status: "draft", createdBy: "sistēma" });
    // The owner's first four come first (D5); which one depends on what was posted before.
    expect(FIRST_CATEGORIES).toContain(p!.subcategoryId);
    firstAdvice = p!.subcategoryId!;
    expect(p!.captionFb).toContain(`${categoryLabel(firstAdvice)}: kas izšķir izvēli.`);
    expect(p!.captionFb).toContain(`${BASE}/izvelies/`);
    expect(p!.captionFb).toContain(`utm_content=${p!.id}`);
    expect(p!.captionIg).toContain("#trilio");
    // The slot is taken: a second run drafts nothing.
    expect(await draftUpcoming(db, deps, WED_MORNING)).toBe(0);
  });

  it("does not send a draft nobody approved", async () => {
    const r = await publishDue(db, deps, new Date(WED_SLOT.getTime() + 60_000));
    expect(r).toEqual({ published: 0, skipped: 1, failed: 0 });
    const [p] = await db.select().from(socialPosts).where(eq(socialPosts.slotAt, WED_SLOT));
    expect(p).toMatchObject({ status: "skipped", error: "Netika apstiprināts līdz publicēšanas laikam." });
  });

  it("sends an approved post to both networks at its time, with the public JPEG", async () => {
    const fri = rigaTime("2031-01-10", 19);
    const f = await factsFor(db, "advice", fri);
    const made = await createPost(db, deps, { ...f!, slotAt: fri, createdBy: "sistēma", mode: "approve" });
    expect(made.ok).toBe(true);
    const id = made.ok ? made.post.id : "";
    // A skipped post does not count for the rotation: the same category again.
    expect(made.ok && made.post.subcategoryId).toBe(firstAdvice);
    await approvePost(db, deps, id, "admin@example.invalid");
    expect(await publishDue(db, deps, new Date(fri.getTime() - 60_000))).toEqual({
      published: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await publishDue(db, deps, new Date(fri.getTime() + 60_000))).toEqual({
      published: 1,
      skipped: 0,
      failed: 0,
    });
    const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id));
    expect(p).toMatchObject({ status: "published", approvedBy: "admin@example.invalid", error: null });
    expect(p!.fbPostId).toMatch(/^mock_facebook_/);
    expect(p!.igMediaId).toMatch(/^mock_instagram_/);
    const sent = mockPosts().filter((m) => m.id === p!.fbPostId || m.id === p!.igMediaId);
    expect(sent.map((m) => m.media)).toEqual([
      `${BASE}/api/social/${id}/image.jpg`,
      `${BASE}/api/social/${id}/image.jpg`,
    ]);
    expect(sent.find((m) => m.network === "instagram")!.caption).toContain("Saite profilā.");

    // Numbers once a day; deleting removes it from both networks.
    expect(await syncInsights(db, deps, rigaTime("2031-01-11", 10), true)).toBe(2);
    expect((await db.select().from(socialInsights).where(eq(socialInsights.postId, id))).length).toBe(2);
    expect(await removePost(db, deps, id)).toBe(true);
    expect(
      mockPosts()
        .filter((m) => m.id === p!.fbPostId || m.id === p!.igMediaId)
        .every((m) => m.removed),
    ).toBe(true);
  });

  it("an approved post more than 6 hours late is not sent", async () => {
    const mon = rigaTime("2031-01-13", 19);
    const f = await factsFor(db, "advice", mon);
    const made = await createPost(db, deps, { ...f!, slotAt: mon, createdBy: "sistēma", mode: "auto" });
    expect(made.ok && made.post.status).toBe("approved");
    const r = await publishDue(db, deps, new Date(mon.getTime() + 7 * 3600_000));
    expect(r.skipped).toBe(1);
  });

  it("in automatic mode the drafts are approved by the system", async () => {
    await updateSocialSettings(db, { mode: "auto" });
    expect((await socialSettings(db)).mode).toBe("auto");
    // Wednesday noon: only Wednesday 19:00 is within a day, and advice always has data.
    expect(await draftUpcoming(db, deps, rigaTime("2031-01-22", 12))).toBe(1);
    const [p] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.slotAt, rigaTime("2031-01-22", 19)));
    expect(p).toMatchObject({ kind: "advice", status: "approved", approvedBy: "sistēma" });
    await updateSocialSettings(db, { mode: "approve" });
  });

  it("a paid offer becomes a post with no personal data, and only once", async () => {
    const [offer] = await db
      .insert(specialOffers)
      .values({
        token: `social-test-${Date.now()}`,
        productName: "Bosch SMV4HTX00E trauku mazgājamā mašīna",
        subcategoryId: "dish",
        priceCents: 59900,
        referencePriceCents: 64900,
        referenceStoreName: "Veikals A",
        deliveryWorkingDays: 3,
        validUntil: new Date("2031-01-01T00:00:00Z"),
        message: "Sveika, Līga! Piedāvājums tieši tev.",
        status: "paid",
        createdBy: "social-test",
      })
      .returning();
    await db.insert(offerOrders).values({
      offerId: offer!.id,
      number: `T-S${Date.now() % 100000}`,
      status: "paid",
      amountCents: 59900,
      ...personal,
      paidAt: new Date(),
      feedbackToken: `social-test-${Date.now()}`,
    });
    const f = await factsFor(db, "offer", new Date());
    expect(f?.facts).toMatchObject({
      kind: "offer",
      specialOfferId: offer!.id,
      trilioPriceCents: 59900,
      shopPriceCents: 64900,
    });
    const made = await createPost(db, deps, {
      ...f!,
      slotAt: rigaTime("2031-01-24", 19),
      createdBy: "social-test",
      mode: "approve",
    });
    expect(made.ok ? "ok" : made.reason).toBe("ok");
    const p = made.ok ? made.post : null;
    const all = [p!.captionFb, p!.captionIg, p!.alt, JSON.stringify(p!.card)].join("\n");
    expect(leaks(all, [...Object.values(personal), "Līga"])).toEqual([]);
    expect(p!.captionFb).toMatch(/Pircējs \p{L}+ī pieprasīja labāku cenu/u);
    // Told once: the same order is not offered again.
    const again = await factsFor(db, "offer", new Date());
    expect(again?.facts && "specialOfferId" in again.facts ? again.facts.specialOfferId : null).not.toBe(
      offer!.id,
    );
  });

  it("lists the week's most searched categories only above the threshold", async () => {
    const now = rigaTime("2031-02-01", 12);
    expect(await factsFor(db, "top_categories", now)).toBeNull();
    await db.insert(visitDaily).values(
      [
        ["fridge", 80],
        ["washer", 40],
        ["vacuum", 20],
      ].map(([sub, views]) => ({
        day: "2031-01-30",
        path: `/social-test/${sub}`,
        section: "results",
        subcategory: String(sub),
        views: Number(views),
        visitors: Number(views),
      })),
    );
    const f = await factsFor(db, "top_categories", now);
    expect(f?.facts).toMatchObject({
      kind: "top_categories",
      categories: [{ id: "fridge", label: "Ledusskapji" }, { id: "washer" }, { id: "vacuum" }],
    });
  });

  it("re-reads the prices before sending: rewrites an untouched post, refuses an edited one", async () => {
    const now = new Date();
    // A category whose seeded offers are fresh enough for a picks post.
    let picks = null;
    for (const sub of ["dish", "fridge", "kettle", "washer", "vacuum"]) {
      const products = await loadCandidates(db, sub);
      if (products.length < 2) continue;
      picks = await picksFacts(db, sub, now);
      if (picks) break;
    }
    if (!picks) return; // seeded feed older than a day: covered in CI, where the seed is fresh
    const slot = new Date(now.getTime() + 3600_000);
    const made = await createPost(db, deps, {
      facts: picks,
      slotAt: slot,
      createdBy: "social-test",
      mode: "approve",
    });
    expect(made.ok).toBe(true);
    const post = made.ok ? made.post : null;
    expect((await refresh(db, deps, post!, now)).ok).toBe(true);
    // Pretend the price was different when drafted.
    const card = { ...(post!.card as Record<string, unknown>) };
    const lines = (card.lines as { side?: string }[]).map((l, i) => (i === 0 ? { ...l, side: "1 €" } : l));
    await db
      .update(socialPosts)
      .set({ card: { ...card, lines } })
      .where(eq(socialPosts.id, post!.id));
    const [stale] = await db.select().from(socialPosts).where(eq(socialPosts.id, post!.id));
    const rewritten = await refresh(db, deps, stale!, now);
    expect(rewritten.ok && (rewritten.post.card as { lines: { side?: string }[] }).lines[0]!.side).not.toBe(
      "1 €",
    );
    // Edited by the owner, then the price moved: not sent.
    expect((await editCaptions(db, post!.id, post!.captionFb, post!.captionIg)).ok).toBe(true);
    await db
      .update(socialPosts)
      .set({ card: { ...card, lines, edited: true } })
      .where(and(eq(socialPosts.id, post!.id)));
    const [edited] = await db.select().from(socialPosts).where(eq(socialPosts.id, post!.id));
    expect(await refresh(db, deps, edited!, now)).toMatchObject({ ok: false });
  });

  it("a picks carousel goes out as four images on both networks", async () => {
    const at = rigaTime("2031-02-09", 19);
    const facts = {
      kind: "picks" as const,
      subcategoryId: "dish",
      category: "Trauku mazgājamās mašīnas",
      picks: [
        { name: "Produkts A1", priceCents: 30000, shop: "Veikals A" },
        { name: "Produkts B2", priceCents: 40000, shop: "Veikals B" },
      ],
      questions: [{ title: "Cik plata?", options: ["45 cm", "60 cm"] }],
      path: "/izvelies/kitchen/dish",
    };
    const made = await createPost(db, deps, { facts, slotAt: at, createdBy: "social-test", mode: "approve" });
    expect(made.ok ? "ok" : made.reason).toBe("ok");
    const id = made.ok ? made.post.id : "";
    // Sent as stored: the refresh only re-reads posts drafted from live picks, which these are not.
    await db
      .update(socialPosts)
      .set({ card: { ...(made.ok ? made.post.card : {}), facts: undefined } })
      .where(eq(socialPosts.id, id));
    const sent = await approvePost(db, deps, id, "admin@example.invalid", { now: true });
    expect(sent?.status).toBe("published");
    const media = mockPosts().filter((m) => m.id === sent!.fbPostId || m.id === sent!.igMediaId);
    for (const m of media)
      expect(m.media.split(" ")).toEqual([
        `${BASE}/api/social/${id}/image.jpg`,
        `${BASE}/api/social/${id}/2/image.jpg`,
        `${BASE}/api/social/${id}/3/image.jpg`,
        `${BASE}/api/social/${id}/4/image.jpg`,
      ]);
  });

  it("refuses an edit that breaks the rules", async () => {
    const [p] = await db.select().from(socialPosts).where(eq(socialPosts.createdBy, "social-test")).limit(1);
    const r = await editCaptions(db, p!.id, "Tev lētākais Latvijā, tikai šodien!", p!.captionIg);
    expect(r.ok).toBe(false);
  });
});
