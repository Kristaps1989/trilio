"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { adAgentRuns, adCampaigns, adCreatives, adKeywords, adProposals, db } from "@/db";
import { audit } from "@/services/admin/audit";
import { adsProvider } from "@/services/ads";
import {
  buildCampaigns,
  getSettings,
  paceBudgets,
  send,
  setCampaignsStatus,
  syncAccount,
  updateSettings,
} from "@/services/ads/account";
import { approveCreative, createCreatives, createPmax, writeCopy } from "@/services/ads/creatives";
import { runAdsJob, runAdsReportSync } from "@/services/ads/job";
import { decideProposal } from "@/services/ads/optimiser";
import { createCaller } from "@/services/llm/client";
import { markSeoDone } from "@/services/seo/search-console";
import { adminOrNull, type Admin } from "../guard";

// Every write in Reklāma (docs/GROWTH_PLAN.md §6): admin-gated, logged in
// admin_audit, and every change to Google goes through the provider and
// ad_changes. Pages show the outcome with ?ok= or ?err=.

async function admin(): Promise<Admin> {
  const a = await adminOrNull();
  if (!a) notFound();
  return a;
}

const log = (a: Admin, action: string, targetId: string, details?: Record<string, unknown>) =>
  audit(db, { adminEmail: a.email, action, targetType: "ads", targetId, details, ip: a.ip });

function provider() {
  const p = adsProvider();
  if (!p) redirect("/admin/reklama?err=off");
  return p;
}

const back = (path: string, params: Record<string, string | number>): never => {
  revalidatePath(path);
  redirect(
    `${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`,
  );
};

const cents = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, "").replace(",", "."))
  .pipe(z.string().regex(/^\d{1,5}(\.\d{1,2})?$/))
  .transform((v) => Math.round(Number(v) * 100));

export async function saveAdSettingsAction(formData: FormData): Promise<void> {
  const a = await admin();
  const parsed = z
    .object({
      daily: cents,
      floor: cents,
      target: z.union([z.literal(""), cents]),
      clickWeight: z.coerce.number().int().min(0).max(100),
      saveWeight: z.coerce.number().int().min(0).max(100),
      mode: z.enum(["observe", "approve", "auto"]),
      reviewCadence: z.enum(["weekly", "daily"]).default("weekly"),
      reviewWeekday: z.coerce.number().int().min(1).max(7).default(1),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/admin/reklama", { err: "settings" });
  const v = parsed.data!;
  await updateSettings(db, {
    dailyBudgetCents: v.daily,
    floorCents: Math.min(v.floor, v.daily),
    targetCostCents: v.target === "" ? null : v.target,
    clickWeight: v.clickWeight,
    saveWeight: v.saveWeight,
    mode: v.mode,
    reviewCadence: v.reviewCadence,
    reviewWeekday: v.reviewWeekday,
  });
  await log(a, "ads.settings", "settings", { ...v });
  // The owner's new number reaches the campaigns now, not tomorrow.
  const p = adsProvider();
  if (p) await paceBudgets(db, p);
  back("/admin/reklama", { ok: "saved" });
}

export async function togglePauseAdsAction(): Promise<void> {
  const a = await admin();
  const s = await getSettings(db);
  await updateSettings(db, { paused: !s.paused });
  const p = adsProvider();
  if (p) await setCampaignsStatus(db, p, s.paused ? "enabled" : "paused");
  await log(a, s.paused ? "ads.resume" : "ads.pause", "all");
  back("/admin/reklama", { ok: s.paused ? "resumed" : "paused" });
}

export async function buildCampaignsAction(): Promise<void> {
  const a = await admin();
  const r = await buildCampaigns(db);
  await log(a, "ads.build", "campaigns", r);
  back("/admin/reklama", { built: `${r.campaigns}/${r.adGroups}/${r.keywords}` });
}

export async function syncAdsAction(): Promise<void> {
  const a = await admin();
  const r = await syncAccount(db, provider());
  await log(a, "ads.sync", "account", r);
  back("/admin/reklama", { synced: `${r.created}/${r.failed}` });
}

export async function setCampaignStatusAction(formData: FormData): Promise<void> {
  const a = await admin();
  const status = z.enum(["enabled", "paused"]).parse(formData.get("status"));
  const id = formData.get("campaignId");
  const campaignId = id ? z.string().uuid().parse(id) : undefined;
  if (status === "enabled" && (await getSettings(db)).paused) back("/admin/reklama", { err: "paused" });
  const n = await setCampaignsStatus(db, provider(), status, campaignId);
  await log(a, `ads.campaign.${status}`, campaignId ?? "all", { count: n });
  back(campaignId ? "/admin/reklama/kampanas" : "/admin/reklama", { enabled: n });
}

export async function runOptimiserAction(): Promise<void> {
  const a = await admin();
  provider();
  const r = await runAdsJob(db, { force: true });
  await log(a, "ads.run", "optimiser", r ?? {});
  if (!r || !r.ok) back("/admin/reklama", { err: `run:${r && !r.ok ? r.reason : "off"}` });
  const ok = r as { proposals: number; applied: number; blocked: number };
  back("/admin/reklama", { ran: `${ok.proposals}/${ok.applied}/${ok.blocked}` });
}

/** "Atjaunināt datus no Google": the last days' numbers now, not at the next hourly sync. */
export async function refreshReportsAction(): Promise<void> {
  const a = await admin();
  provider();
  const r = await runAdsReportSync(db, { force: true });
  await log(a, "ads.reports", "reports", r ?? {});
  if (!r || !r.ok) back("/admin/reklama", { err: `reports:${r?.error ?? "off"}` });
  back("/admin/reklama", { ok: "refreshed" });
}

export async function decideProposalAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const [row] = await db.select().from(adProposals).where(eq(adProposals.id, id));
  if (!row) notFound();
  const r = await decideProposal(db, provider(), row, approve, a.email);
  await log(a, approve ? "ads.proposal.approve" : "ads.proposal.reject", id, { ok: r.ok, reason: r.reason });
  back(
    "/admin/reklama/priekslikumi",
    r.ok ? { ok: approve ? "applied" : "rejected" } : { err: r.reason ?? "failed" },
  );
}

export async function addNegativeAction(formData: FormData): Promise<void> {
  const a = await admin();
  const parsed = z
    .object({
      text: z.string().trim().min(2).max(80),
      campaignId: z.union([z.literal("all"), z.string().uuid()]),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/admin/reklama/atslegvardi", { err: "negative" });
  const { text, campaignId } = parsed.data!;
  const campaigns = await db.select().from(adCampaigns);
  const p = adsProvider();
  for (const c of campaigns.filter((c) => campaignId === "all" || c.id === campaignId)) {
    if (c.kind !== "search") continue;
    let googleId: string | null = null;
    if (p && c.googleId) {
      const r = await send(db, p, {
        op: "create_negative",
        campaign: c.googleId,
        text: text.toLowerCase(),
        match: "phrase",
      });
      googleId = r.ok ? (r.id ?? null) : null;
    }
    await db
      .insert(adKeywords)
      .values({
        campaignId: c.id,
        text: text.toLowerCase(),
        match: "phrase",
        negative: true,
        source: "owner",
        googleId,
        status: googleId ? "enabled" : "draft",
      })
      .onConflictDoNothing();
  }
  await log(a, "ads.negative", campaignId, { text });
  back("/admin/reklama/atslegvardi", { ok: "negative" });
}

export async function generateCreativesAction(formData: FormData): Promise<void> {
  const a = await admin();
  const sub = z
    .string()
    .regex(/^[a-z]{2,20}$/)
    .parse(formData.get("subcategoryId"));
  const caller = process.env.ANTHROPIC_API_KEY ? createCaller(db) : null;
  const copy = await writeCopy(db, caller, sub);
  await createCreatives(db, sub, copy, caller ? "claude" : "template");
  await log(a, "ads.creatives.generate", sub);
  back("/admin/reklama/reklamas", { ok: "generated" });
}

export async function decideCreativeAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const [c] = await db.select().from(adCreatives).where(eq(adCreatives.id, id));
  if (!c) notFound();
  if (!approve) {
    await db.update(adCreatives).set({ status: "rejected" }).where(eq(adCreatives.id, id));
    await log(a, "ads.creative.reject", id);
    back("/admin/reklama/reklamas", { ok: "rejected" });
  }
  const r = await approveCreative(db, provider(), c);
  await log(a, "ads.creative.approve", id, { ok: r.ok });
  back("/admin/reklama/reklamas", r.ok ? { ok: "approved" } : { err: r.error ?? "upload" });
}

export async function createPmaxAction(formData: FormData): Promise<void> {
  const a = await admin();
  const groupId = z
    .string()
    .regex(/^[a-z]{2,20}$/)
    .parse(formData.get("groupId"));
  const budget = cents.parse(String(formData.get("budget") ?? "5"));
  const r = await createPmax(db, provider(), groupId, budget);
  await log(a, "ads.pmax", groupId, { ok: r.ok, error: r.error });
  back("/admin/reklama/kampanas", r.ok ? { ok: "pmax" } : { err: r.error ?? "pmax" });
}

export async function memoNoteAction(formData: FormData): Promise<void> {
  const a = await admin();
  const id = z.string().uuid().parse(formData.get("id"));
  const note = z
    .string()
    .max(2000)
    .parse(String(formData.get("note") ?? ""));
  await db
    .update(adAgentRuns)
    .set({ ownerNote: note || null })
    .where(eq(adAgentRuns.id, id));
  await log(a, "ads.memo.note", id);
  back("/admin/reklama/strategija", { ok: "saved" });
}

export async function seoDoneAction(formData: FormData): Promise<void> {
  const a = await admin();
  const query = z.string().max(200).parse(formData.get("query"));
  const page = z.string().max(200).parse(formData.get("page"));
  await markSeoDone(db, query, page);
  await log(a, "seo.done", query, { page });
  back("/admin/reklama/seo", { ok: "done" });
}
