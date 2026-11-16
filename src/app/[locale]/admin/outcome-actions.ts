"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  DESCRIPTION_MAX,
  NOTHING_REASONS,
  descriptionIssues,
  parseTypedAttributes,
  type NothingReason,
} from "@/domain/offers/alternative";
import { endOfRigaDay } from "@/domain/offers/offers";
import { audit } from "@/services/admin/audit";
import {
  markMonitoringOnly,
  markNothing,
  offerAlternative,
  setMinMarginPct,
  waitForPartner,
} from "@/services/admin/outcomes";
import { compare } from "@/services/offers/alternative";
import { offerMailDeps } from "@/services/offers/deps";
import { loadProduct } from "@/db/queries/catalog";
import { adminOrNull, type Admin } from "./guard";

// The answers to price requests (docs/ALTERNATIVE_OFFER_PLAN.md §3): nothing to
// offer, price monitoring only, wait for the partner, and the alternative. Every
// write is checked against ADMIN_EMAILS and logged.

async function admin(): Promise<Admin> {
  const a = await adminOrNull();
  if (!a) notFound();
  return a;
}

const log = (a: Admin, action: string, targetId: string, details?: Record<string, unknown>) =>
  audit(db, { adminEmail: a.email, action, targetType: "product", targetId, details, ip: a.ip });

const leadPath = (id: string) => `/admin/pieprasijums/${id}`;

export async function nothingAction(formData: FormData): Promise<void> {
  const a = await admin();
  const productId = z.uuid().parse(formData.get("productId"));
  const keys = formData.getAll("keys").map(String).filter(Boolean);
  const reason = z
    .enum(NOTHING_REASONS as [NothingReason, ...NothingReason[]])
    .catch("other")
    .parse(formData.get("reason"));
  const note = z
    .string()
    .trim()
    .max(1000)
    .catch("")
    .parse(formData.get("note") ?? "");
  const res = await markNothing(
    db,
    {
      productId,
      keys: keys.length ? keys : undefined,
      reason,
      note: note || null,
      notify: formData.get("notify") === "1",
    },
    a.email,
    offerMailDeps(),
  );
  await log(a, "lead.nothing_to_offer", productId, { reason, ...res });
  revalidatePath("/admin", "layout");
  redirect(`${leadPath(productId)}?answered=nothing&marked=${res.marked}&emailed=${res.emailed}`);
}

export async function monitoringAction(formData: FormData): Promise<void> {
  const a = await admin();
  const productId = z.uuid().parse(formData.get("productId"));
  const keys = formData.getAll("keys").map(String).filter(Boolean);
  const n = await markMonitoringOnly(db, { productId, keys: keys.length ? keys : undefined }, a.email);
  await log(a, "lead.monitoring_only", productId, { marked: n });
  revalidatePath("/admin", "layout");
  redirect(`${leadPath(productId)}?answered=monitoring&marked=${n}`);
}

export async function waitAction(formData: FormData): Promise<void> {
  const a = await admin();
  const productId = z.uuid().parse(formData.get("productId"));
  const days = z.coerce.number().int().min(1).max(90).parse(formData.get("days"));
  const until = endOfRigaDay(new Date(Date.now() + days * 24 * 3600 * 1000));
  const ok = await waitForPartner(db, productId, until, a.email);
  if (ok) await log(a, "lead.wait", productId, { days });
  revalidatePath("/admin", "layout");
  redirect(`${leadPath(productId)}?answered=${ok ? "wait" : "wait_error"}`);
}

/** Several leads at once from the Pieprasījums list: monitoring only, or nothing to offer with the e-mail. */
export async function bulkLeadsAction(formData: FormData): Promise<void> {
  const a = await admin();
  const ids = z.array(z.uuid()).max(200).parse(formData.getAll("productIds").map(String));
  const op = z.enum(["nothing", "monitoring"]).parse(formData.get("op"));
  let marked = 0;
  const deps = offerMailDeps();
  for (const productId of ids) {
    if (op === "monitoring") marked += await markMonitoringOnly(db, { productId }, a.email);
    else
      marked += (
        await markNothing(db, { productId, reason: "other", note: null, notify: true }, a.email, deps)
      ).marked;
    await log(a, op === "monitoring" ? "lead.monitoring_only" : "lead.nothing_to_offer", productId, {
      bulk: true,
    });
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/pieprasijums?bulk=${op}&marked=${marked}`);
}

export async function minMarginAction(formData: FormData): Promise<void> {
  const a = await admin();
  const pct = Number(String(formData.get("pct") ?? "").replace(",", "."));
  const ok = await setMinMarginPct(db, pct);
  if (ok)
    await audit(db, {
      adminEmail: a.email,
      action: "settings.min_margin",
      targetType: "settings",
      targetId: "offers.min_margin_pct",
      details: { pct },
      ip: a.ip,
    });
  revalidatePath("/admin/sistema");
  redirect(`/admin/sistema?margin=${ok ? "saved" : "error"}`);
}

// ---------------------------------------------------------------- the alternative

const euros = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, "").replace(",", "."))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/))
  .transform((v) => Math.round(Number(v) * 100));

const AltForm = z.object({
  originalId: z.uuid(),
  alternativeId: z.union([z.literal(""), z.uuid()]),
  keys: z.array(z.string().regex(/^[ur]:[0-9a-f-]{36}$/)),
  price: euros,
  cost: z.union([z.literal(""), euros]).optional(),
  condition: z.enum(["new", "refurbished"]),
  grade: z.string().trim().max(40).optional(),
  warrantyMonths: z.coerce.number().int().min(0).max(120),
  deliveryWorkingDays: z.coerce.number().int().min(1).max(30),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  message: z.string().trim().max(1000).optional(),
  supplierNote: z.string().trim().max(500).optional(),
  description: z.string().trim().max(DESCRIPTION_MAX).optional(),
  imageSetId: z.union([z.literal(""), z.uuid()]).optional(),
  manualName: z.string().trim().max(200).optional(),
  manualBrand: z.string().trim().max(80).optional(),
  manualModel: z.string().trim().max(80).optional(),
  manualEan: z.string().trim().max(20).optional(),
});

export type AltFormState = { error: string | null; problems?: string[] };

export async function alternativeAction(_prev: AltFormState, formData: FormData): Promise<AltFormState> {
  const a = await admin();
  const parsed = AltForm.safeParse({
    ...Object.fromEntries(formData),
    keys: formData.getAll("keys").map(String),
  });
  if (!parsed.success) return { error: `invalid:${parsed.error.issues[0]?.path.join(".")}` };
  const v = parsed.data;
  if (!v.keys.length) return { error: "recipients" };
  // Manual products: the key attributes typed, numbers as numbers.
  const attributes = parseTypedAttributes(
    [...formData.entries()]
      .filter(([k, raw]) => k.startsWith("attr_") && typeof raw === "string")
      .map(([k, raw]) => [k.slice(5), raw as string]),
  );
  const manual = v.alternativeId
    ? null
    : {
        name: v.manualName ?? "",
        brand: v.manualBrand ?? "",
        modelCode: v.manualModel || null,
        ean: v.manualEan || null,
        attributes,
      };
  // The description may not claim more than the comparison allows.
  const original = await loadProduct(db, v.originalId);
  const alt = v.alternativeId ? await loadProduct(db, v.alternativeId) : null;
  if (!original) return { error: "product" };
  const label = compare(original, alt ?? { attributes }).label;
  if (v.description && descriptionIssues(v.description, label).length) return { error: "description" };
  const res = await offerAlternative(
    db,
    {
      originalId: v.originalId,
      alternativeId: v.alternativeId || null,
      manual,
      keys: v.keys,
      priceCents: v.price,
      costCents: typeof v.cost === "number" ? v.cost : null,
      condition: v.condition,
      grade: v.grade || null,
      warrantyMonths: v.warrantyMonths,
      deliveryWorkingDays: v.deliveryWorkingDays,
      validUntil: endOfRigaDay(new Date(`${v.validUntil}T12:00:00Z`)),
      message: v.message || null,
      supplierNote: v.supplierNote || null,
      description: v.description || null,
      imageSetId: v.imageSetId || null,
    },
    a.email,
    offerMailDeps(),
  );
  if (!res.ok) return { error: res.reason, problems: res.problems };
  await log(a, "lead.alternative", v.originalId, {
    alternativeId: v.alternativeId || null,
    manual: !v.alternativeId,
    priceCents: v.price,
    sent: res.sent,
    asked: res.asked,
  });
  revalidatePath("/admin", "layout");
  redirect(`${leadPath(v.originalId)}?answered=alternative&sent=${res.sent}&asked=${res.asked}`);
}
