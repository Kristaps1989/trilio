"use server";

import { eq } from "drizzle-orm";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db, offerEvents, stores, users } from "@/db";
import { endOfRigaDay } from "@/domain/offers/offers";
import { audit, OFFERS_PAUSED, offersPaused, setFlag } from "@/services/admin/audit";
import { retryEprelErrors } from "@/services/admin/stats";
import { ingestStore } from "@/services/ingestion/run";
import { offerMailDeps } from "@/services/offers/deps";
import { sendOrderEmail } from "@/services/offers/emails";
import { cancelOffer, createOffers, extendOffer, sendOffer } from "@/services/offers/offers";
import { addOrderNote, correctDeliveredAt, moveOrder, orderWithOffer } from "@/services/offers/orders";
import { adminOrNull, type Admin } from "./guard";
import { userLang } from "@/services/offers/texts";

// Every admin write: checked against ADMIN_EMAILS on the server and logged in
// admin_audit (docs/ADMIN_AND_OFFERS_PLAN.md §2.1–2.2).

async function admin(): Promise<Admin> {
  const a = await adminOrNull();
  if (!a) notFound();
  return a;
}

const log = (
  a: Admin,
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, unknown>,
) => audit(db, { adminEmail: a.email, action, targetType, targetId, details, ip: a.ip });

const euros = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, "").replace(",", "."))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/))
  .transform((v) => Math.round(Number(v) * 100));

const optionalEuros = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(euros.optional());

const OfferForm = z.object({
  productId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1),
  price: euros,
  cost: optionalEuros,
  condition: z.enum(["new", "refurbished"]),
  grade: z.string().trim().max(40).optional(),
  warrantyMonths: z.coerce.number().int().min(0).max(120),
  quantity: z.coerce.number().int().min(1).max(999),
  deliveryWorkingDays: z.coerce.number().int().min(1).max(30),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  message: z.string().trim().max(1000).optional(),
  supplierNote: z.string().trim().max(500).optional(),
  intent: z.enum(["draft", "send"]),
});

export type OfferFormState = { error: string | null };

/** "Saglabāt melnrakstu" / "Nosūtīt": one offer per recipient; people without consent are skipped. */
export async function createOfferAction(_prev: OfferFormState, formData: FormData): Promise<OfferFormState> {
  const a = await admin();
  const parsed = OfferForm.safeParse({
    ...Object.fromEntries(formData),
    userIds: formData.getAll("userIds").map(String),
  });
  if (!parsed.success) return { error: `invalid:${parsed.error.issues[0]?.path.join(".")}` };
  const v = parsed.data;
  const validUntil = endOfRigaDay(new Date(`${v.validUntil}T12:00:00Z`));
  const created = await createOffers(
    db,
    {
      productId: v.productId,
      userIds: v.userIds,
      priceCents: v.price,
      condition: v.condition,
      grade: v.grade || null,
      warrantyMonths: v.warrantyMonths,
      quantity: v.quantity,
      deliveryWorkingDays: v.deliveryWorkingDays,
      validUntil,
      message: v.message || null,
      supplierNote: v.supplierNote || null,
      costCents: v.cost ?? null,
    },
    a.email,
  );
  if (!created.ok) return { error: created.reason };
  if (created.offerIds.length === 0) return { error: "no_consent" };
  for (const id of created.offerIds) await log(a, "offer.create", "offer", id, { priceCents: v.price });
  let failed = 0;
  if (v.intent === "send") {
    const deps = offerMailDeps();
    for (const id of created.offerIds) {
      const sent = await sendOffer(db, id, deps);
      if (sent.ok) await log(a, "offer.send", "offer", id, { emailed: sent.emailed });
      else failed++;
    }
  }
  revalidatePath("/admin/piedavajumi");
  const first = created.offerIds[0]!;
  const query = new URLSearchParams({
    created: String(created.offerIds.length),
    skipped: String(created.skipped.length),
    failed: String(failed),
  });
  redirect(
    created.offerIds.length === 1 ? `/admin/piedavajumi/${first}?${query}` : `/admin/piedavajumi?${query}`,
  );
}

export async function sendOfferAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("offerId"));
  const sent = await sendOffer(db, id, offerMailDeps());
  if (sent.ok) await log(a, "offer.send", "offer", id, { emailed: sent.emailed });
  revalidatePath(`/admin/piedavajumi/${id}`);
  redirect(`/admin/piedavajumi/${id}?${sent.ok ? "sent=1" : `error=${sent.reason}`}`);
}

export async function cancelOfferAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("offerId"));
  if (await cancelOffer(db, id, a.email)) await log(a, "offer.cancel", "offer", id);
  revalidatePath(`/admin/piedavajumi/${id}`);
  redirect(`/admin/piedavajumi/${id}`);
}

export async function extendOfferAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("offerId"));
  const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .parse(formData.get("validUntil"));
  const until = endOfRigaDay(new Date(`${day}T12:00:00Z`));
  if (await extendOffer(db, id, until, a.email))
    await log(a, "offer.extend", "offer", id, { validUntil: day });
  revalidatePath(`/admin/piedavajumi/${id}`);
  redirect(`/admin/piedavajumi/${id}`);
}

const Step = z.object({
  orderId: z.string().uuid(),
  to: z.enum(["packed", "shipped", "delivered", "return_requested", "returned", "refunded", "cancelled"]),
  carrier: z.string().max(40).optional(),
  trackingNumber: z.string().max(80).optional(),
  trackingUrl: z.string().url().max(500).optional().or(z.literal("")),
  refundReference: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
});

/** "Sagatavots" · "Nodots kurjeram" · "Piegādāts" · returns and refunds; the buyer gets the e-mail for the step. */
export async function orderStepAction(formData: FormData): Promise<void> {
  const a = await admin();
  const s = Step.parse(Object.fromEntries(formData));
  const moved = await moveOrder(db, s.orderId, {
    to: s.to,
    by: "admin",
    carrier: s.carrier || undefined,
    trackingNumber: s.trackingNumber || undefined,
    trackingUrl: s.trackingUrl || undefined,
    refundReference: s.refundReference || undefined,
    note: s.note || undefined,
  });
  if (!moved.ok) redirect(`/admin/pasutijumi/${s.orderId}?error=${moved.reason}`);
  await log(a, `order.${s.to}`, "order", s.orderId, {
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    refundReference: s.refundReference,
  });
  const mail = (
    {
      shipped: "shipped",
      delivered: "delivered",
      return_requested: "return_requested",
      refunded: "refunded",
    } as const
  )[s.to as "shipped"];
  const found = await orderWithOffer(db, s.orderId);
  if (mail && found)
    await sendOrderEmail(mail, found.order, found.offer, offerMailDeps(), {
      lang: await userLang(db, found.order.userId),
    });
  revalidatePath(`/admin/pasutijumi/${s.orderId}`);
  redirect(`/admin/pasutijumi/${s.orderId}?done=${s.to}`);
}

export async function orderNoteAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("orderId"));
  const note = z.string().trim().min(1).max(1000).parse(formData.get("note"));
  if (await addOrderNote(db, id, note, a.email)) await log(a, "order.note", "order", id);
  revalidatePath(`/admin/pasutijumi/${id}`);
  redirect(`/admin/pasutijumi/${id}`);
}

export async function resolveProblemAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("orderId"));
  const found = await orderWithOffer(db, id);
  if (!found) notFound();
  await db.insert(offerEvents).values({
    offerId: found.offer.id,
    orderId: id,
    kind: "problem_resolved",
    source: "admin",
    note: a.email,
  });
  await log(a, "order.problem_resolved", "order", id);
  revalidatePath(`/admin/pasutijumi/${id}`);
  redirect(`/admin/pasutijumi/${id}`);
}

export async function correctDeliveryAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("orderId"));
  const day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .parse(formData.get("deliveredAt"));
  const at = new Date(`${day}T12:00:00Z`);
  if (at.getTime() > Date.now()) redirect(`/admin/pasutijumi/${id}?error=future`);
  if (await correctDeliveredAt(db, id, at, a.email))
    await log(a, "order.delivery_corrected", "order", id, { day });
  revalidatePath(`/admin/pasutijumi/${id}`);
  redirect(`/admin/pasutijumi/${id}`);
}

export async function userNoteAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("userId"));
  const note = z
    .string()
    .max(4000)
    .parse(formData.get("note") ?? "");
  await db
    .update(users)
    .set({ adminNote: note.trim() || null })
    .where(eq(users.id, id));
  await log(a, "user.note", "user", id);
  revalidatePath(`/admin/lietotaji/${id}`);
  redirect(`/admin/lietotaji/${id}?saved=1`);
}

/** The kill switch: no offer or reminder e-mail leaves while it is on. */
export async function toggleOffersPausedAction(): Promise<void> {
  const a = await admin();
  const paused = await offersPaused(db);
  await setFlag(db, OFFERS_PAUSED, paused ? null : "1");
  await log(a, paused ? "offers.resume" : "offers.pause", "flag", OFFERS_PAUSED);
  revalidatePath("/admin/sistema");
  redirect("/admin/sistema");
}

/** "Palaist tagad": one shop's ingestion in the background; the page shows the run when it finishes. */
export async function runIngestAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("storeId"));
  const [store] = await db.select().from(stores).where(eq(stores.id, id));
  if (!store) notFound();
  await log(a, "ingest.run", "store", id, { slug: store.slug });
  after(() => ingestStore(db, store).catch((err) => console.error("admin ingest failed", err)));
  redirect("/admin/sistema?ingest=started");
}

export async function retryEprelAction(): Promise<void> {
  const a = await admin();
  const n = await retryEprelErrors(db);
  await log(a, "eprel.retry", "eprel", "errors", { count: n });
  redirect(`/admin/sistema?eprel=${n}`);
}
