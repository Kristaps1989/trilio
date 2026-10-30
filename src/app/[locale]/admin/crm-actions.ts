"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { audit } from "@/services/admin/audit";
import { addLeadNote, addPartnerRequest } from "@/services/admin/crm";
import { addOfferNote } from "@/services/offers/offers";
import { adminOrNull } from "./guard";

// CRM writes (docs/CRM_PLAN.md §6): the partner mark, lead notes and offer
// notes. Checked against ADMIN_EMAILS and logged like every admin write.

async function admin() {
  const a = await adminOrNull();
  if (!a) notFound();
  return a;
}

/** Only back to an admin page. */
function backTo(raw: FormDataEntryValue | null): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/admin") && !v.startsWith("//") ? v : "/admin";
}

const cents = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, "").replace(",", "."))
  .pipe(z.union([z.literal(""), z.string().regex(/^\d+(\.\d{1,2})?$/)]))
  .transform((v) => (v === "" ? null : Math.round(Number(v) * 100)));

export async function setPartnerAction(formData: FormData): Promise<void> {
  const a = await admin();
  const input = z
    .object({
      productId: z.string().uuid(),
      orderId: z.string().uuid().nullable(),
      status: z.enum(["requested", "confirmed", "unavailable"]),
      partner: z.string().max(100).nullable(),
      ref: z.string().max(100).nullable(),
      cost: cents,
      note: z.string().max(1000).nullable(),
    })
    .safeParse({
      productId: formData.get("productId"),
      orderId: formData.get("orderId") || null,
      status: formData.get("status"),
      partner: formData.get("partner") || null,
      ref: formData.get("ref") || null,
      cost: String(formData.get("cost") ?? ""),
      note: formData.get("note") || null,
    });
  const back = backTo(formData.get("back"));
  const sep = back.includes("?") ? "&" : "?";
  if (!input.success) redirect(`${back}${sep}error=partner`);
  const v = input.data;
  const row = await addPartnerRequest(
    db,
    {
      productId: v.productId,
      orderId: v.orderId,
      status: v.status,
      partner: v.partner,
      ref: v.ref,
      costCents: v.cost,
      note: v.note,
    },
    a.email,
  );
  if (row)
    await audit(db, {
      adminEmail: a.email,
      action: `partner.${v.status}`,
      targetType: v.orderId ? "order" : "product",
      targetId: v.orderId ?? v.productId,
      details: { partner: v.partner, ref: v.ref },
      ip: a.ip,
    });
  revalidatePath("/admin", "layout");
  redirect(`${back}${sep}partner=${row ? "saved" : "error"}`);
}

export async function leadNoteAction(formData: FormData): Promise<void> {
  const a = await admin();
  const productId = z.string().uuid().parse(formData.get("productId"));
  const note = z.string().trim().min(1).max(1000).parse(formData.get("note"));
  if (await addLeadNote(db, productId, note, a.email))
    await audit(db, {
      adminEmail: a.email,
      action: "lead.note",
      targetType: "product",
      targetId: productId,
      ip: a.ip,
    });
  revalidatePath(`/admin/pieprasijums/${productId}`);
  redirect(`/admin/pieprasijums/${productId}`);
}

export async function offerNoteAction(formData: FormData): Promise<void> {
  const a = await admin();
  const offerId = z.string().uuid().parse(formData.get("offerId"));
  const note = z.string().trim().min(1).max(1000).parse(formData.get("note"));
  if (await addOfferNote(db, offerId, note, a.email))
    await audit(db, {
      adminEmail: a.email,
      action: "offer.note",
      targetType: "offer",
      targetId: offerId,
      ip: a.ip,
    });
  revalidatePath(`/admin/piedavajumi/${offerId}`);
  redirect(`/admin/piedavajumi/${offerId}`);
}
