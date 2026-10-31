"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { rigaTime } from "@/domain/social/schedule";
import { audit } from "@/services/admin/audit";
import { socialDeps } from "@/services/social/job";
import {
  approvePost,
  createReel,
  editCaptions,
  generateNow,
  removePost,
  skipPost,
  updateSocialSettings,
} from "@/services/social/posts";
import { adminOrNull, type Admin } from "../guard";

// Every write in Sociālie tīkli (docs/SOCIAL_PLAN.md §7): admin-gated and
// logged in admin_audit. The page shows the outcome with ?ok= or ?err=.

const PATH = "/admin/sociali";

async function admin(): Promise<Admin> {
  const a = await adminOrNull();
  if (!a) notFound();
  return a;
}

const log = (a: Admin, action: string, targetId: string, details?: Record<string, unknown>) =>
  audit(db, { adminEmail: a.email, action, targetType: "social_post", targetId, details, ip: a.ip });

const back = (params: Record<string, string>): never => {
  revalidatePath(PATH);
  redirect(`${PATH}?${new URLSearchParams(params).toString()}`);
};

function deps() {
  const d = socialDeps(db);
  if (!d) back({ err: "off" });
  return d!;
}

const Id = z.object({ id: z.uuid() });

export async function settingsAction(form: FormData) {
  const a = await admin();
  const enabled = form.get("enabled") === "on";
  const mode = form.get("mode") === "auto" ? "auto" : "approve";
  await updateSocialSettings(db, { enabled, mode });
  await log(a, "social_settings", "settings", { enabled, mode });
  back({ ok: "saved" });
}

const Kind = z.enum(["picks", "price_drop", "advice", "offer", "top_categories", "top_products"]);

export async function generateAction(form: FormData) {
  const a = await admin();
  const kind = Kind.safeParse(form.get("kind"));
  if (!kind.success) back({ err: "invalid" });
  const r = await generateNow(db, deps(), kind.data!, a.email);
  if (!r.ok) back({ err: r.reason === "no_data" ? "no_data" : "failed" });
  const id = r.ok ? r.post.id : "";
  await log(a, "social_generate", id, { kind: kind.data });
  back({ ok: "generated", post: id });
}

export async function approveAction(form: FormData) {
  const a = await admin();
  const p = Id.safeParse({ id: form.get("id") });
  if (!p.success) back({ err: "invalid" });
  const now = form.get("now") === "1";
  const r = await approvePost(db, deps(), p.data!.id, a.email, { now });
  await log(a, now ? "social_publish_now" : "social_approve", p.data!.id);
  if (!r) back({ err: "failed" });
  back({ ok: now ? (r!.status === "published" ? "published" : "approved") : "approved" });
}

const Text = z.object({
  id: z.uuid(),
  fb: z.string().trim().min(1).max(2200),
  ig: z.string().trim().min(1).max(2200),
});

export async function captionsAction(form: FormData) {
  const a = await admin();
  const p = Text.safeParse({ id: form.get("id"), fb: form.get("fb"), ig: form.get("ig") });
  if (!p.success) back({ err: "invalid" });
  const r = await editCaptions(db, p.data!.id, p.data!.fb, p.data!.ig);
  if (!r.ok) back({ err: r.reason });
  await log(a, "social_edit", p.data!.id);
  back({ ok: "saved" });
}

export async function skipAction(form: FormData) {
  const a = await admin();
  const p = Id.safeParse({ id: form.get("id") });
  if (!p.success) back({ err: "invalid" });
  await skipPost(db, p.data!.id, `Izlaida ${a.email}.`);
  await log(a, "social_skip", p.data!.id);
  back({ ok: "skipped" });
}

export async function removeAction(form: FormData) {
  const a = await admin();
  const p = Id.safeParse({ id: form.get("id") });
  if (!p.success) back({ err: "invalid" });
  const ok = await removePost(db, deps(), p.data!.id);
  await log(a, "social_remove", p.data!.id, { ok });
  back(ok ? { ok: "removed" } : { err: "failed" });
}

const Reel = z.object({
  videoUrl: z.url().refine((u) => u.startsWith("https://")),
  caption: z.string().trim().min(5).max(2200),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function reelAction(form: FormData) {
  const a = await admin();
  const p = Reel.safeParse({
    videoUrl: form.get("videoUrl"),
    caption: form.get("caption"),
    day: form.get("day"),
  });
  if (!p.success) back({ err: "invalid" });
  const r = await createReel(db, deps(), { ...p.data!, slotAt: rigaTime(p.data!.day, 19), admin: a.email });
  if (!r.ok) back({ err: r.reason });
  await log(a, "social_reel", r.ok ? r.post.id : "");
  back({ ok: "reel" });
}
