import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offers, pushSubscriptions, radars, stores, users } from "@/db/schema";
import { loadCandidates, loadProducts } from "@/db/queries/catalog";
import { activeRadarsForEvaluation, purgeDeletedRadars, recordRadarEvent } from "@/db/queries/radar";
import { energyPriceFromEnv } from "@/domain/energy/energy";
import { getSubcategory } from "@/domain/questions/catalog";
import type { Answers } from "@/domain/questions/schema";
import { evaluateRadar, trackedOffer, type RadarEvent } from "@/domain/radar/evaluate";
import { currentSubscription, hasAccess } from "@/services/billing/engine";
import { formatEur } from "@/i18n/format";
import { createEmailSender, type EmailSender } from "@/services/notify/email";
import { createPushSender, type PushSender } from "@/services/notify/push";

// Runs after each ingestion: evaluates every active radar of a user with
// access, sends at most one notification per radar per day, moves the
// baseline to the notified price, and purges soft-deleted radars.

export type RadarJobResult = { evaluated: number; notified: number; skippedNoAccess: number; purged: number };

type Texts = {
  dropSubject: (v: { name: string; price: string }) => string;
  dropBody: (v: { name: string; shop: string; price: string; delta: string }) => string;
  similarSubject: (v: { name: string }) => string;
  similarBody: (v: { name: string; price: string; shop: string }) => string;
  view: string;
};

export async function runRadarJob(
  db: Db,
  opts: { email?: EmailSender; push?: PushSender; baseUrl: string; texts: Texts; now?: Date },
): Promise<RadarJobResult> {
  const now = opts.now ?? new Date();
  const email = opts.email ?? createEmailSender();
  const push = opts.push ?? createPushSender();
  const energyPrice = energyPriceFromEnv();
  const result: RadarJobResult = { evaluated: 0, notified: 0, skippedNoAccess: 0, purged: 0 };

  const rows = await activeRadarsForEvaluation(db);
  if (rows.length === 0) {
    result.purged = await purgeDeletedRadars(db);
    return result;
  }
  const productIds = [...new Set(rows.map((r) => r.radar.productId))];
  const tracked = new Map((await loadProducts(db, productIds)).map((p) => [p.id, p]));
  const comparablesBySub = new Map<string, Awaited<ReturnType<typeof loadCandidates>>>();
  const accessByUser = new Map<string, boolean>();

  for (const row of rows) {
    const r = row.radar;
    const product = tracked.get(r.productId);
    if (!product) continue;
    if (!accessByUser.has(row.userId)) {
      accessByUser.set(row.userId, hasAccess(await currentSubscription(db, row.userId), now));
    }
    if (!accessByUser.get(row.userId)) {
      result.skippedNoAccess++;
      continue;
    }
    result.evaluated++;

    let comparables: Awaited<ReturnType<typeof loadCandidates>> = [];
    if (r.scope !== "only") {
      if (!comparablesBySub.has(product.subcategoryId)) {
        comparablesBySub.set(product.subcategoryId, await loadCandidates(db, product.subcategoryId));
      }
      comparables = comparablesBySub.get(product.subcategoryId)!;
    }
    const answers = row.answers ? (stripTrailing(row.answers) as Answers) : null;
    const events = evaluateRadar(
      {
        id: r.id,
        productId: r.productId,
        threshold: r.threshold,
        scope: r.scope,
        storeIds: r.storeIds,
        includeRefurbished: r.includeRefurbished,
        baselinePriceCents: r.baselinePriceCents,
        lastNotifiedAt: r.lastNotifiedAt,
        paused: r.paused,
        answers,
      },
      product,
      {
        products: comparables,
        sub: getSubcategory(product.subcategoryId) ?? null,
        energyPriceCentsPerKwh: energyPrice,
      },
      now,
    );
    if (events.length === 0) {
      // Keep the baseline current when there was none (radar created without an offer).
      if (r.baselinePriceCents === null) {
        const best = trackedOffer(product, r);
        if (best)
          await db.update(radars).set({ baselinePriceCents: best.priceCents }).where(eq(radars.id, r.id));
      }
      continue;
    }

    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
    if (!user) continue;
    const sent = await notify(
      db,
      { userId: row.userId, email: user.email, channels: r.channels, events, products: tracked, comparables },
      { email, push, baseUrl: opts.baseUrl, texts: opts.texts },
    );
    for (const e of events) await recordRadarEvent(db, r.id, e, sent);
    const drop = events.find((e) => e.kind === "drop");
    await db
      .update(radars)
      .set({ lastNotifiedAt: now, ...(drop ? { baselinePriceCents: drop.newPriceCents } : {}) })
      .where(eq(radars.id, r.id));
    result.notified++;
  }
  result.purged = await purgeDeletedRadars(db);
  return result;
}

async function notify(
  db: Db,
  input: {
    userId: string;
    email: string;
    channels: string[];
    events: RadarEvent[];
    products: Map<string, { name: string }>;
    comparables: { id: string; name: string }[];
  },
  deps: { email: EmailSender; push: PushSender; baseUrl: string; texts: Texts },
): Promise<string[]> {
  const sent: string[] = [];
  const nameOf = (id: string) =>
    input.products.get(id)?.name ?? input.comparables.find((p) => p.id === id)?.name ?? id;
  const offerIds = input.events.map((e) => e.offerId);
  const shopRows = await db
    .select({ id: offers.id, shop: stores.displayName })
    .from(offers)
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(inArray(offers.id, offerIds));
  const shopOf = (id: string) => shopRows.find((s) => s.id === id)?.shop ?? "";
  const url = `${deps.baseUrl}/radars`;

  const lines = input.events.map((e) => {
    const v = {
      name: nameOf(e.productId),
      shop: shopOf(e.offerId),
      price: formatEur(e.newPriceCents),
      delta: formatEur(e.oldPriceCents - e.newPriceCents),
    };
    return e.kind === "drop" ? deps.texts.dropBody(v) : deps.texts.similarBody(v);
  });
  const first = input.events[0]!;
  const subject =
    first.kind === "drop"
      ? deps.texts.dropSubject({ name: nameOf(first.productId), price: formatEur(first.newPriceCents) })
      : deps.texts.similarSubject({ name: nameOf(first.productId) });

  if (input.channels.includes("email")) {
    const r = await deps.email.send({
      to: input.email,
      subject,
      text: `${lines.join("\n")}\n\n${deps.texts.view}: ${url}`,
    });
    if (r.ok) sent.push("email");
  }
  if (input.channels.includes("push")) {
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, input.userId));
    for (const s of subs) {
      const r = await deps.push.send(s, { title: subject, body: lines[0]!, url });
      if (r.ok) sent.push("push");
      else if (r.reason === "gone") await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    }
  }
  return [...new Set(sent)];
}

function stripTrailing(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) if (!k.startsWith("$")) out[k] = v;
  return out;
}
