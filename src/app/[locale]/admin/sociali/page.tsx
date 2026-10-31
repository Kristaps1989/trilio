/* eslint-disable @next/next/no-img-element -- admin previews of generated images, not public pages */
import type { Metadata } from "next";
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db, socialInsights, socialPosts, type SocialPost } from "@/db";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../guard";
import { AdminTitle, Chip, inputClass, labelClass, Section, Table } from "../ui";
import { Outcome } from "../reklama/shared";
import { socialProvider } from "@/services/social";
import { socialSettings } from "@/services/social/posts";
import {
  approveAction,
  captionsAction,
  generateAction,
  reelAction,
  removeAction,
  settingsAction,
  skipAction,
} from "./actions";

// Admin → Sociālie tīkli (docs/SOCIAL_PLAN.md §7): the queue to approve or
// edit, the history with reach, the settings and the Reels upload.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sociālie tīkli" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const KINDS = ["picks", "price_drop", "advice", "offer", "top_categories", "top_products"] as const;
const when = (d: Date) =>
  new Intl.DateTimeFormat("lv-LV", {
    timeZone: "Europe/Riga",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

export default async function SocialPage({ searchParams }: Props) {
  await requireAdmin("/admin/sociali");
  const t = await getTranslations("admin.social");
  const sp = await searchParams;
  const settings = await socialSettings(db);
  const provider = socialProvider();
  const conn = !provider
    ? t("connOff")
    : provider.name === "mock"
      ? t("connMock")
      : (await provider.tokenOk())
        ? t("connOk")
        : t("connBad");
  const queue = await db
    .select()
    .from(socialPosts)
    .where(inArray(socialPosts.status, ["draft", "approved", "failed"]))
    .orderBy(socialPosts.slotAt)
    .limit(30);
  const now = new Date();
  const since = new Date(now.getTime() - 60 * 86_400_000);
  const history = await db
    .select()
    .from(socialPosts)
    .where(and(inArray(socialPosts.status, ["published", "skipped"]), gte(socialPosts.slotAt, since)))
    .orderBy(desc(socialPosts.slotAt))
    .limit(40);
  const totals = history.length
    ? await db
        .select({
          postId: socialInsights.postId,
          reach: sql<number>`max(${socialInsights.reach})`.mapWith(Number),
          reactions: sql<number>`max(${socialInsights.reactions})`.mapWith(Number),
          comments: sql<number>`max(${socialInsights.comments})`.mapWith(Number),
          clicks: sql<number>`max(${socialInsights.linkClicks})`.mapWith(Number),
        })
        .from(socialInsights)
        .where(gte(socialInsights.day, since.toISOString().slice(0, 10)))
        .groupBy(socialInsights.postId, socialInsights.network)
    : [];
  const sum = (id: string) =>
    totals
      .filter((x) => x.postId === id)
      .reduce(
        (a, x) => ({
          reach: a.reach + x.reach,
          reactions: a.reactions + x.reactions,
          comments: a.comments + x.comments,
          clicks: a.clicks + x.clicks,
        }),
        { reach: 0, reactions: 0, comments: 0, clicks: 0 },
      );
  const ok = sp.ok ? t(`ok_${sp.ok}` as "ok_saved") : null;
  const err = sp.err
    ? ["no_data", "off", "invalid", "failed"].includes(sp.err)
      ? t(`err_${sp.err}` as "err_failed")
      : sp.err
    : null;
  const tone = (s: SocialPost["status"]) =>
    s === "approved" || s === "published" ? "lime" : s === "failed" ? "warning" : "neutral";

  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub")} />
      <Outcome ok={ok} err={err} />
      <p className="text-[15px] text-mist" data-social-connection>
        <span className="font-semibold">{t("connection")}:</span> {conn}
      </p>
      <p className="text-sm text-stone">{t("rules")}</p>

      <Section title={t("settings")} id="social-settings">
        <form action={settingsAction} className="flex flex-wrap items-end gap-4">
          <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold text-mist">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.enabled}
              className="h-5 w-5 accent-lime"
            />
            {t("enabled")}
          </label>
          <label className={labelClass}>
            {t("mode")}
            <select name="mode" defaultValue={settings.mode} className={inputClass}>
              <option value="approve">{t("modeApprove")}</option>
              <option value="auto">{t("modeAuto")}</option>
            </select>
          </label>
          <Button type="submit" size="sm">
            {t("save")}
          </Button>
        </form>
      </Section>

      <Section title={t("queue")} id="social-queue">
        <form action={generateAction} className="flex flex-wrap items-end gap-3" data-social-generate>
          <label className={labelClass}>
            {t("kind")}
            <select name="kind" className={inputClass}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind_${k}`)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm">
            {t("generate")}
          </Button>
          <span className="text-sm text-stone">{t("generateHint")}</span>
        </form>
        {queue.length === 0 ? (
          <p className="text-[15px] text-stone">{t("queueEmpty")}</p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {queue.map((p) => (
              <li
                key={p.id}
                id={`post-${p.id}`}
                className={`flex flex-col gap-3 rounded-panel-lg border-[1.5px] p-4 ${sp.post === p.id ? "border-lime" : "border-line-25"}`}
                data-social-post={p.kind}
                data-social-status={p.status}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-mist">
                    {t(`kind_${p.kind}`)} · {when(p.slotAt)}
                  </span>
                  <Chip tone={tone(p.status)}>{t(`status_${p.status}`)}</Chip>
                </div>
                {p.videoUrl ? (
                  <a href={p.videoUrl} className="text-[15px] text-lime underline">
                    {p.videoUrl}
                  </a>
                ) : (
                  <img
                    src={`/api/social/${p.id}/image.jpg`}
                    alt={t("imageAlt", { alt: p.alt })}
                    className="h-auto w-full max-w-[420px] rounded-control border border-line-25"
                    loading="lazy"
                  />
                )}
                <p className="text-sm text-stone">
                  {t(`source_${p.source === "claude" ? "claude" : "template"}`)}
                  {(p.card as { edited?: boolean }).edited ? ` · ${t("edited")}` : ""}
                </p>
                {p.error ? (
                  <p className="text-sm font-semibold text-warning" role="status">
                    {p.error}
                  </p>
                ) : null}
                <form action={captionsAction} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <label className={labelClass}>
                    {t("captionFb")}
                    <textarea
                      name="fb"
                      defaultValue={p.captionFb}
                      rows={8}
                      className={`${inputClass} min-h-40 py-2`}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("captionIg")}
                    <textarea
                      name="ig"
                      defaultValue={p.captionIg}
                      rows={8}
                      className={`${inputClass} min-h-40 py-2`}
                    />
                  </label>
                  <div>
                    <Button type="submit" size="sm" variant="outline">
                      {t("saveText")}
                    </Button>
                  </div>
                </form>
                <div className="flex flex-wrap gap-2">
                  {p.status !== "approved" ? (
                    <form action={approveAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button type="submit" size="sm">
                        {p.status === "failed" ? t("retry") : t("approve")}
                      </Button>
                    </form>
                  ) : null}
                  <form action={approveAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="now" value="1" />
                    <Button type="submit" size="sm" variant="outline">
                      {t("publishNow")}
                    </Button>
                  </form>
                  <form action={skipAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <Button type="submit" size="sm" variant="outline">
                      {t("skip")}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("history")} id="social-history">
        <Table
          caption={t("history")}
          empty={t("historyEmpty")}
          head={[
            t("when"),
            t("kind"),
            t("networks"),
            t("reach"),
            t("reactions"),
            t("comments"),
            t("clicks"),
            "",
          ]}
          rows={history.map((p) => {
            const s = sum(p.id);
            return [
              when(p.slotAt),
              <span key="k">
                {t(`kind_${p.kind}`)} <Chip tone={tone(p.status)}>{t(`status_${p.status}`)}</Chip>
              </span>,
              [p.fbPostId ? "Facebook" : null, p.igMediaId ? "Instagram" : null].filter(Boolean).join(", ") ||
                "—",
              s.reach,
              s.reactions,
              s.comments,
              s.clicks,
              p.status === "published" ? (
                <form key="r" action={removeAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <Button type="submit" size="sm" variant="outline">
                    {t("remove")}
                  </Button>
                </form>
              ) : (
                (p.error ?? "")
              ),
            ];
          })}
        />
      </Section>

      <Section title={t("reel")} id="social-reel">
        <p className="text-sm text-stone">{t("reelHint")}</p>
        <form action={reelAction} className="flex flex-col gap-3">
          <label className={labelClass}>
            {t("videoUrl")}
            <input type="url" name="videoUrl" required placeholder="https://" className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("reelCaption")}
            <textarea name="caption" required rows={4} className={`${inputClass} min-h-28 py-2`} />
          </label>
          <label className={labelClass}>
            {t("reelDay")}
            <input type="date" name="day" required className={inputClass} />
          </label>
          <div>
            <Button type="submit" size="sm">
              {t("reelAdd")}
            </Button>
          </div>
        </form>
      </Section>
    </>
  );
}
