import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  notifyRequests,
  offerEvents,
  partnerRequests,
  requestOutcomes,
  savedItems,
  specialOffers,
  users,
  type ManualProduct,
  type RequestOutcome,
} from "@/db/schema";
import { loadProduct } from "@/db/queries/catalog";
import { REQUEST_TTL_MS, consentVersion, requestOfferable } from "@/domain/notify/notify";
import {
  DEFAULT_MIN_MARGIN_PCT,
  alternativePriceProblems,
  mayOfferAlternativeDirectly,
  requestChip,
  suggestNothing,
  undecided,
  type NothingReason,
  type PriceProblem,
  type RequestChip,
  type StoredOutcome,
} from "@/domain/offers/alternative";
import { worthAsking } from "@/domain/offers/sourcing";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import type { EmailSender } from "@/services/notify/email";
import { getFlag, offersPaused, setFlag } from "@/services/admin/audit";
import { compare, shopPrice, suggestionsFor } from "@/services/offers/alternative";
import { composeAskEmail, composeNothingEmail } from "@/services/offers/compose-answers";
import type { OfferMailContext } from "@/services/offers/compose";
import { cancelOffer, createOffers, ensureOffersToken, sendOffer } from "@/services/offers/offers";

// Answering every price request (docs/ALTERNATIVE_OFFER_PLAN.md): who asked for a
// product and what each was answered, the admin's decisions (an alternative,
// nothing to offer, price monitoring only, wait for the partner), the e-mails
// that go with them, and the shopper's "Jā / Nē" to the question asked first.

const token = () => randomBytes(32).toString("base64url");
export const MIN_MARGIN_FLAG = "offers.min_margin_pct";

export async function minMarginPct(db: Db): Promise<number> {
  const raw = await getFlag(db, MIN_MARGIN_FLAG);
  const v = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 50 ? v : DEFAULT_MIN_MARGIN_PCT;
}

export async function setMinMarginPct(db: Db, pct: number): Promise<boolean> {
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) return false;
  await setFlag(db, MIN_MARGIN_FLAG, String(Math.round(pct * 10) / 10));
  return true;
}

// ---------------------------------------------------------------- who asked

export type Requester = {
  /** "u:<userId>" or "r:<notifyRequestId>". */
  key: string;
  userId: string | null;
  notifyRequestId: string | null;
  email: string;
  lang: UiLocale;
  savedAt: Date;
  /** The price this person saw (saved baseline), or null. */
  seenCents: number | null;
  /** When they asked for a lower price ("Iegūt lētāk"), or null for a plain save with offers allowed. */
  requestedAt: Date | null;
  /** The price e-mails run until then (accounts); null for an e-mail-only request. */
  watchUntil: Date | null;
  wantsOffers: boolean;
  /** Their request's text mentioned an alternative: one may be sent without asking first. */
  direct: boolean;
  outcome: RequestOutcome | null;
  offered: boolean;
  chip: RequestChip;
};

const keyOf = (r: { userId: string | null; notifyRequestId: string | null }) =>
  r.userId ? `u:${r.userId}` : `r:${r.notifyRequestId}`;

/** The newest outcome per person for these products. */
async function latestOutcomes(db: Db, productIds: string[]) {
  const out = new Map<string, Map<string, RequestOutcome>>();
  if (!productIds.length) return out;
  const rows = await db
    .select()
    .from(requestOutcomes)
    .where(inArray(requestOutcomes.productId, productIds))
    .orderBy(desc(requestOutcomes.createdAt));
  for (const r of rows) {
    const m = out.get(r.productId) ?? new Map<string, RequestOutcome>();
    if (!m.has(keyOf(r))) m.set(keyOf(r), r);
    out.set(r.productId, m);
  }
  return out;
}

/** People who got an offer for this very product (not cancelled), by key. */
async function offeredKeys(db: Db, productIds: string[]) {
  const out = new Map<string, Set<string>>();
  if (!productIds.length) return out;
  const rows = await db
    .select({
      productId: specialOffers.productId,
      userId: specialOffers.userId,
      notifyRequestId: specialOffers.notifyRequestId,
    })
    .from(specialOffers)
    .where(
      and(
        inArray(specialOffers.productId, productIds),
        isNull(specialOffers.alternativeToProductId),
        sql`${specialOffers.status} not in ('cancelled')`,
      ),
    );
  for (const r of rows) {
    const set = out.get(r.productId!) ?? new Set<string>();
    if (r.userId) set.add(`u:${r.userId}`);
    if (r.notifyRequestId) set.add(`r:${r.notifyRequestId}`);
    out.set(r.productId!, set);
  }
  return out;
}

type ProductFacts = { id: string; subcategoryId: string; priceCents: number | null };

/**
 * Everyone who asked about these products, each with their answer chip: accounts that
 * saved the product (with their request's consent text, if they came through
 * "Iegūt lētāk") and e-mail-only requests still kept (7 days).
 */
export async function requestersOfMany(
  db: Db,
  items: ProductFacts[],
  partnerStatus: Map<string, "requested" | "confirmed" | "unavailable">,
  now = new Date(),
): Promise<Map<string, Requester[]>> {
  const ids = items.map((i) => i.id);
  const out = new Map<string, Requester[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const [savers, requests, outcomes, offered] = await Promise.all([
    db
      .select({
        productId: savedItems.productId,
        userId: users.id,
        email: users.email,
        locale: users.locale,
        optIn: users.offersOptIn,
        savedAt: savedItems.createdAt,
        seenCents: savedItems.baselinePriceCents,
        until: savedItems.alertsUntil,
      })
      .from(savedItems)
      .innerJoin(users, eq(users.id, savedItems.userId))
      .where(and(eq(savedItems.kind, "product"), inArray(savedItems.productId, ids))),
    db
      .select()
      .from(notifyRequests)
      .where(and(eq(notifyRequests.kind, "product"), inArray(notifyRequests.productId, ids)))
      .orderBy(desc(notifyRequests.createdAt)),
    latestOutcomes(db, ids),
    offeredKeys(db, ids),
  ]);
  const facts = new Map(items.map((i) => [i.id, i]));
  // The newest request per account and product: its consent says whether an alternative may go directly.
  const requestOf = new Map<string, (typeof requests)[number]>();
  for (const r of requests)
    if (r.userId && !requestOf.has(`${r.productId}:${r.userId}`))
      requestOf.set(`${r.productId}:${r.userId}`, r);
  const push = (productId: string, r: Omit<Requester, "chip" | "outcome" | "offered">) => {
    const f = facts.get(productId)!;
    const outcome = outcomes.get(productId)?.get(r.key) ?? null;
    const isOffered = offered.get(productId)?.has(r.key) ?? false;
    const chip = requestChip({
      wantsOffers: r.wantsOffers,
      worthAsking: worthAsking(f.subcategoryId, f.priceCents ?? r.seenCents),
      offered: isOffered,
      outcome: (outcome?.outcome as StoredOutcome | undefined) ?? null,
      partner: partnerStatus.get(productId) ?? null,
      ended: r.watchUntil !== null && r.watchUntil <= now,
    });
    out.get(productId)!.push({ ...r, outcome, offered: isOffered, chip });
  };
  for (const s of savers) {
    const req = requestOf.get(`${s.productId}:${s.userId}`);
    push(s.productId!, {
      key: `u:${s.userId}`,
      userId: s.userId,
      notifyRequestId: null,
      email: s.email,
      lang: s.locale === "en" ? "en" : "lv",
      savedAt: s.savedAt,
      seenCents: s.seenCents,
      requestedAt: req?.offers ? req.createdAt : null,
      watchUntil: s.until,
      wantsOffers: !!s.optIn,
      direct: !!s.optIn && !!req?.offers && mayOfferAlternativeDirectly(consentVersion(req.consent)),
    });
  }
  const since = now.getTime() - REQUEST_TTL_MS;
  for (const r of requests) {
    if (r.userId || r.activatedAt || r.confirmedAt || r.createdAt.getTime() < since) continue;
    const ok = requestOfferable(r, now) === "ok";
    push(r.productId!, {
      key: `r:${r.id}`,
      userId: null,
      notifyRequestId: r.id,
      email: r.email,
      lang: r.locale === "en" ? "en" : "lv",
      savedAt: r.createdAt,
      seenCents: null,
      requestedAt: r.createdAt,
      watchUntil: null,
      wantsOffers: ok,
      direct: ok && mayOfferAlternativeDirectly(consentVersion(r.consent)),
    });
  }
  for (const list of out.values()) list.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
  return out;
}

async function partnerOf(db: Db, productId: string) {
  const rows = await db
    .select()
    .from(partnerRequests)
    .where(and(eq(partnerRequests.productId, productId), isNull(partnerRequests.orderId)))
    .orderBy(desc(partnerRequests.createdAt));
  return { latest: rows[0] ?? null, history: rows };
}

export async function requestersOf(db: Db, productId: string, now = new Date()) {
  const product = await loadProduct(db, productId);
  if (!product) return [];
  const { latest } = await partnerOf(db, productId);
  const status = new Map(latest ? [[productId, latest.status] as const] : []);
  const shop = shopPrice(product);
  return (
    (
      await requestersOfMany(
        db,
        [{ id: productId, subcategoryId: product.subcategoryId, priceCents: shop?.cents ?? null }],
        status,
        now,
      )
    ).get(productId) ?? []
  );
}

/**
 * Per product, for the work lists: how many still wait for Trilio's answer, and
 * "Atkal pieejams" (after "nothing to offer", a partner confirmed or the price fell 5 %).
 */
export async function answerSummary(
  db: Db,
  items: (ProductFacts & {
    partner: { status: "requested" | "confirmed" | "unavailable"; at: Date } | null;
  })[],
  now = new Date(),
): Promise<Map<string, { undecided: number; backAt: Date | null }>> {
  const status = new Map(items.filter((i) => i.partner).map((i) => [i.id, i.partner!.status]));
  const people = await requestersOfMany(db, items, status, now);
  const out = new Map<string, { undecided: number; backAt: Date | null }>();
  for (const i of items) {
    const list = people.get(i.id) ?? [];
    const nothing = list.filter((r) => r.chip === "nothing_to_offer" && r.outcome);
    let backAt: Date | null = null;
    if (nothing.length) {
      const decided = new Date(Math.max(...nothing.map((r) => r.outcome!.createdAt.getTime())));
      const shopThen = Math.min(...nothing.map((r) => r.outcome!.shopCents ?? Infinity));
      if (i.partner?.status === "confirmed" && i.partner.at > decided) backAt = i.partner.at;
      else if (i.priceCents !== null && Number.isFinite(shopThen) && i.priceCents <= shopThen * 0.95)
        backAt = now;
    }
    out.set(i.id, { undecided: list.filter((r) => undecided(r.chip)).length, backAt });
  }
  return out;
}

// ---------------------------------------------------------------- suggestion

/** Trilio's suggestion that there is nothing to offer, and its reason (§7). */
export async function nothingSuggestion(db: Db, productId: string): Promise<NothingReason | null> {
  const product = await loadProduct(db, productId);
  if (!product) return null;
  const { latest, history } = await partnerOf(db, productId);
  const shop = shopPrice(product);
  const byPartner = new Map<string, "requested" | "confirmed" | "unavailable">();
  for (const h of history) {
    const name = (h.partner ?? "").trim().toLowerCase() || h.id;
    if (!byPartner.has(name)) byPartner.set(name, h.status);
  }
  let alternativeAvailable = true;
  if (latest?.status === "unavailable") {
    const list = await suggestionsFor(db, product, shop?.cents ?? null);
    const confirmed = list.length
      ? await db
          .select({ productId: partnerRequests.productId })
          .from(partnerRequests)
          .where(
            and(
              inArray(
                partnerRequests.productId,
                list.map((s) => s.product.id),
              ),
              eq(partnerRequests.status, "confirmed"),
              isNull(partnerRequests.orderId),
            ),
          )
      : [];
    alternativeAvailable = confirmed.length > 0;
  }
  return suggestNothing({
    partner: latest ? { status: latest.status, costCents: latest.costCents } : null,
    partnersAsked: [...byPartner.values()].map((status) => ({ status })),
    bestShopCents: shop?.cents ?? null,
    minMarginPct: await minMarginPct(db),
    alternativeAvailable,
  });
}

// ---------------------------------------------------------------- decisions

export type AnswerDeps = OfferMailContext & { email: EmailSender; now?: Date };

/** The unsubscribe link for a person's answer e-mails: the account's offers link or the request's. */
async function unsubscribeFor(db: Db, r: Requester, baseUrl: string): Promise<string | undefined> {
  if (r.userId) {
    const t = await ensureOffersToken(db, r.userId);
    return `${baseUrl}${localizedPath(`/piedavajumi/atteikties/${t}`, r.lang)}`;
  }
  if (r.notifyRequestId) {
    const [req] = await db
      .select({ token: notifyRequests.token })
      .from(notifyRequests)
      .where(eq(notifyRequests.id, r.notifyRequestId));
    if (req) return `${baseUrl}${localizedPath(`/piedavajumi/atteikties/${req.token}`, r.lang)}`;
  }
  return undefined;
}

function pick(list: Requester[], keys: string[] | undefined, allow: (r: Requester) => boolean) {
  const wanted = keys ? new Set(keys) : null;
  return list.filter((r) => (wanted ? wanted.has(r.key) : true) && allow(r));
}

export type NothingInput = {
  productId: string;
  /** Requester keys; omitted: everyone still waiting for an answer. */
  keys?: string[];
  reason: NothingReason;
  note: string | null;
  notify: boolean;
};

/**
 * "Nav ko piedāvāt": records the outcome for each person still waiting (or those
 * chosen) and, when asked, sends each one short e-mail (§4.4), never twice.
 */
export async function markNothing(
  db: Db,
  input: NothingInput,
  by: string,
  deps: AnswerDeps,
): Promise<{ marked: number; emailed: number }> {
  const now = deps.now ?? new Date();
  const product = await loadProduct(db, input.productId);
  if (!product) return { marked: 0, emailed: 0 };
  const shop = shopPrice(product);
  const list = pick(await requestersOf(db, input.productId, now), input.keys, (r) =>
    input.keys ? r.chip !== "offered" && r.chip !== "ended" : undecided(r.chip),
  );
  const paused = await offersPaused(db);
  let emailed = 0;
  for (const r of list) {
    // Only people who asked for an answer get one; the e-mail goes once per person and product.
    const already = await db
      .select({ id: requestOutcomes.id })
      .from(requestOutcomes)
      .where(
        and(
          eq(requestOutcomes.productId, input.productId),
          r.userId
            ? eq(requestOutcomes.userId, r.userId)
            : eq(requestOutcomes.notifyRequestId, r.notifyRequestId!),
          eq(requestOutcomes.outcome, "nothing_to_offer"),
          isNotNull(requestOutcomes.notifiedAt),
        ),
      )
      .limit(1);
    let notifiedAt: Date | null = null;
    if (input.notify && r.wantsOffers && !already.length && !paused) {
      const sent = await deps.email.send(
        composeNothingEmail({
          ...deps,
          to: r.email,
          lang: r.lang,
          askedName: product.name,
          requestedAt: r.requestedAt,
          watchUntil: r.watchUntil,
          shopCents: shop?.cents ?? null,
          unsubscribeUrl: await unsubscribeFor(db, r, deps.baseUrl),
        }),
      );
      if (sent.ok) {
        notifiedAt = now;
        emailed++;
      }
    }
    await db.insert(requestOutcomes).values({
      token: token(),
      productId: input.productId,
      userId: r.userId,
      notifyRequestId: r.notifyRequestId,
      email: r.email,
      outcome: "nothing_to_offer",
      reason: input.reason,
      shopCents: shop?.cents ?? null,
      note: input.note?.trim().slice(0, 1000) || null,
      createdBy: by,
      createdAt: now,
      notifiedAt,
    });
  }
  return { marked: list.length, emailed };
}

/** "Tikai sekot cenai": no answer is owed; nothing is sent. */
export async function markMonitoringOnly(
  db: Db,
  input: { productId: string; keys?: string[]; note?: string | null },
  by: string,
  now = new Date(),
): Promise<number> {
  const list = pick(await requestersOf(db, input.productId, now), input.keys, (r) =>
    input.keys
      ? r.chip !== "offered" && r.chip !== "ended" && r.chip !== "monitoring_only"
      : undecided(r.chip),
  );
  if (!list.length) return 0;
  await db.insert(requestOutcomes).values(
    list.map((r) => ({
      token: token(),
      productId: input.productId,
      userId: r.userId,
      notifyRequestId: r.notifyRequestId,
      email: r.email,
      outcome: "monitoring_only" as const,
      note: input.note?.trim().slice(0, 1000) || null,
      createdBy: by,
      createdAt: now,
    })),
  );
  return list.length;
}

/** "Pagaidīt": the partner expects stock; the lead returns to Uzdevumi on that date. */
export async function waitForPartner(
  db: Db,
  productId: string,
  until: Date,
  by: string,
  now = new Date(),
): Promise<boolean> {
  if (until <= now) return false;
  const { latest } = await partnerOf(db, productId);
  if (!latest) return false;
  await db.insert(partnerRequests).values({
    productId,
    status: "unavailable",
    partner: latest.partner,
    partnerOrderRef: latest.partnerOrderRef,
    costCents: latest.costCents,
    waitUntil: until,
    note: latest.note,
    createdBy: by,
  });
  return true;
}

// ---------------------------------------------------------------- the alternative

export type AlternativeInput = {
  originalId: string;
  /** A product from the catalogue, or null with `manual` for one no shop lists. */
  alternativeId: string | null;
  manual: ManualProduct | null;
  keys?: string[];
  priceCents: number;
  costCents: number | null;
  condition: "new" | "refurbished";
  grade: string | null;
  warrantyMonths: number;
  deliveryWorkingDays: number;
  validUntil: Date;
  message: string | null;
  supplierNote: string | null;
  description: string | null;
  imageSetId: string | null;
};

export type AlternativeResult =
  | { ok: true; sent: number; asked: number; skipped: number }
  | {
      ok: false;
      reason: "product" | "recipients" | "price" | "validity" | "manual" | "paused";
      problems?: PriceProblem[];
    };

/**
 * Sends one alternative to everyone still waiting (or those chosen): directly to people
 * whose request text mentioned an alternative, and to everyone else the question first,
 * with the offer held as a draft until they say yes (owner, 16 Nov 2026). The two price
 * checks are hard rules.
 */
export async function offerAlternative(
  db: Db,
  input: AlternativeInput,
  by: string,
  deps: AnswerDeps,
): Promise<AlternativeResult> {
  const now = deps.now ?? new Date();
  if (await offersPaused(db)) return { ok: false, reason: "paused" };
  const original = await loadProduct(db, input.originalId);
  if (!original) return { ok: false, reason: "product" };
  const alt = input.alternativeId ? await loadProduct(db, input.alternativeId) : null;
  if (input.alternativeId && !alt) return { ok: false, reason: "product" };
  if (!alt) {
    const m = input.manual;
    if (!m?.name.trim() || !m.brand.trim() || !input.description?.trim() || !input.imageSetId)
      return { ok: false, reason: "manual" };
  }
  const people = pick(
    await requestersOf(db, input.originalId, now),
    input.keys,
    (r) => r.wantsOffers && (input.keys ? r.chip !== "offered" && r.chip !== "ended" : undecided(r.chip)),
  );
  if (!people.length) return { ok: false, reason: "recipients" };
  const originalShop = shopPrice(original)?.cents ?? null;
  const seen = people.map((p) => p.seenCents ?? originalShop).filter((x): x is number => x !== null);
  const originalSeenCents = seen.length ? Math.min(...seen) : null;
  const problems = alternativePriceProblems({
    offerCents: input.priceCents,
    alternativeShopCents: alt ? (shopPrice(alt)?.cents ?? null) : null,
    originalSeenCents,
  });
  if (problems.length) return { ok: false, reason: "price", problems };
  const comparison = compare(original, alt ?? { attributes: input.manual!.attributes });
  const created = await createOffers(
    db,
    {
      productId: alt?.id ?? original.id,
      userIds: people.filter((p) => p.userId).map((p) => p.userId!),
      requestIds: people.filter((p) => p.notifyRequestId).map((p) => p.notifyRequestId!),
      priceCents: input.priceCents,
      condition: input.condition,
      grade: input.grade,
      warrantyMonths: input.warrantyMonths,
      quantity: 1,
      deliveryWorkingDays: input.deliveryWorkingDays,
      validUntil: input.validUntil,
      message: input.message,
      supplierNote: input.supplierNote,
      costCents: input.costCents,
      description: input.description,
      imageSetId: input.imageSetId,
      alternativeTo: {
        productId: original.id,
        name: original.name,
        comparison: { label: comparison.label, lines: comparison.lines, originalSeenCents },
      },
      manualProduct: alt ? null : input.manual,
    },
    by,
  );
  if (!created.ok)
    return {
      ok: false,
      reason:
        created.reason === "validity" ? "validity" : created.reason === "price" ? "price" : "recipients",
    };
  const byKey = new Map(created.created.map((c) => [keyOf(c), c.offerId]));
  let sent = 0;
  let asked = 0;
  const shop = shopPrice(original)?.cents ?? null;
  for (const p of people) {
    const offerId = byKey.get(p.key);
    if (!offerId) continue;
    const row = {
      token: token(),
      productId: original.id,
      userId: p.userId,
      notifyRequestId: p.notifyRequestId,
      email: p.email,
      offerId,
      shopCents: shop,
      createdBy: by,
      createdAt: now,
    };
    if (p.direct) {
      const res = await sendOffer(db, offerId, { ...deps, now });
      await db.insert(requestOutcomes).values({
        ...row,
        outcome: "alternative_offered",
        notifiedAt: res.ok && res.emailed ? now : null,
      });
      if (res.ok) sent++;
    } else {
      const [outcome] = await db
        .insert(requestOutcomes)
        .values({ ...row, outcome: "alternative_asked" })
        .returning();
      const base = `${deps.baseUrl}${localizedPath(`/piedavajumi/alternativa/${outcome!.token}`, p.lang)}`;
      const res = await deps.email.send(
        composeAskEmail({
          ...deps,
          to: p.email,
          lang: p.lang,
          askedName: original.name,
          requestedAt: p.requestedAt,
          watchUntil: p.watchUntil,
          yesUrl: `${base}?atbilde=ja`,
          noUrl: `${base}?atbilde=ne`,
          unsubscribeUrl: await unsubscribeFor(db, p, deps.baseUrl),
        }),
      );
      if (res.ok)
        await db.update(requestOutcomes).set({ notifiedAt: now }).where(eq(requestOutcomes.id, outcome!.id));
      asked++;
    }
  }
  return { ok: true, sent, asked, skipped: created.skipped.length };
}

// ---------------------------------------------------------------- the shopper's answers

export async function outcomeByToken(db: Db, value: string): Promise<RequestOutcome | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const [row] = await db.select().from(requestOutcomes).where(eq(requestOutcomes.token, value));
  return row ?? null;
}

export type AskAnswer = "yes" | "no";

/**
 * The shopper's "Jā" or "Nē" to the question asked first (§4.3). "Jā" is their consent
 * to this one alternative: the held offer goes out at once. "Nē" cancels it, and the
 * price of the product they asked for is still followed. Answering twice changes nothing.
 */
export async function answerAsk(
  db: Db,
  value: string,
  answer: AskAnswer,
  deps: AnswerDeps,
): Promise<
  { ok: true; answer: AskAnswer; offerToken: string | null } | { ok: false; reason: "unknown" | "expired" }
> {
  const now = deps.now ?? new Date();
  const row = await outcomeByToken(db, value);
  if (!row || row.outcome !== "alternative_asked") return { ok: false, reason: "unknown" };
  const [offer] = row.offerId
    ? await db.select().from(specialOffers).where(eq(specialOffers.id, row.offerId))
    : [];
  if (row.answer)
    return { ok: true, answer: row.answer, offerToken: row.answer === "yes" ? (offer?.token ?? null) : null };
  const claimed = await db
    .update(requestOutcomes)
    .set({ answer, answeredAt: now })
    .where(and(eq(requestOutcomes.id, row.id), isNull(requestOutcomes.answer)))
    .returning({ id: requestOutcomes.id });
  if (!claimed.length) return answerAsk(db, value, answer, deps);
  if (answer === "no") {
    if (offer) await cancelOffer(db, offer.id, "pircējs: nē alternatīvai");
    await db.insert(requestOutcomes).values({
      token: token(),
      productId: row.productId,
      userId: row.userId,
      notifyRequestId: row.notifyRequestId,
      email: row.email,
      outcome: "nothing_to_offer",
      reason: "other",
      note: "Pircējs atbildēja: nē, tikai sekot cenai",
      createdBy: "pircējs",
      createdAt: now,
    });
    return { ok: true, answer, offerToken: null };
  }
  if (!offer || offer.status !== "draft" || offer.validUntil <= now) return { ok: false, reason: "expired" };
  const res = await sendOffer(db, offer.id, { ...deps, now });
  if (!res.ok) return { ok: false, reason: "expired" };
  await db.insert(requestOutcomes).values({
    token: token(),
    productId: row.productId,
    userId: row.userId,
    notifyRequestId: row.notifyRequestId,
    email: row.email,
    outcome: "alternative_offered",
    offerId: offer.id,
    shopCents: row.shopCents,
    note: "Pircējs atbildēja: jā",
    createdBy: "pircējs",
    createdAt: now,
    notifiedAt: res.emailed ? now : null,
  });
  return { ok: true, answer, offerToken: offer.token };
}

/** "Gribu tikai pieprasīto modeli" on the offer page: the alternative is withdrawn, monitoring goes on. */
export async function declineAlternative(db: Db, offerToken: string, now = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(offerToken)) return false;
  const [offer] = await db.select().from(specialOffers).where(eq(specialOffers.token, offerToken));
  if (!offer?.alternativeToProductId || !["sent", "opened"].includes(offer.status)) return false;
  const rows = await db
    .update(specialOffers)
    .set({ status: "cancelled", cancelledAt: now, declinedAt: now })
    .where(and(eq(specialOffers.id, offer.id), inArray(specialOffers.status, ["sent", "opened"])))
    .returning({ id: specialOffers.id });
  if (!rows.length) return false;
  await db.insert(offerEvents).values({ offerId: offer.id, kind: "declined", source: "buyer" });
  await db
    .update(requestOutcomes)
    .set({ answer: "no", answeredAt: now })
    .where(and(eq(requestOutcomes.offerId, offer.id), isNull(requestOutcomes.answer)));
  return true;
}

/** Offers held as drafts until the shopper answers the question asked first: not the admin's to send. */
export async function heldOfferIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ offerId: requestOutcomes.offerId })
    .from(requestOutcomes)
    .where(
      and(
        eq(requestOutcomes.outcome, "alternative_asked"),
        isNull(requestOutcomes.answer),
        isNotNull(requestOutcomes.offerId),
      ),
    );
  return new Set(rows.map((r) => r.offerId!));
}
