/* eslint-disable @next/next/no-img-element -- admin previews of generated PNGs, not public images */
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { adAds, adCreatives, adGroups, db } from "@/db";
import { catalog } from "@/domain/questions/catalog";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, inputClass, labelClass, Section, Table } from "../../ui";
import { decideCreativeAction, generateCreativesAction } from "../actions";
import { AdsNav, Outcome } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reklāmas · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsCreatives({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/reklamas");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const creatives = await db.select().from(adCreatives).orderBy(desc(adCreatives.createdAt)).limit(60);
  const ads = await db
    .select({ a: adAds, group: adGroups.name })
    .from(adAds)
    .innerJoin(adGroups, eq(adGroups.id, adAds.adGroupId))
    .orderBy(adGroups.name)
    .limit(100);
  const subs = catalog.groups.flatMap((g) => g.subcategories);
  const label = (id: string) => subs.find((s) => s.id === id)?.label ?? id;
  const tone = (s: string) =>
    s === "uploaded" || s === "approved" ? "lime" : s === "rejected" ? "warning" : "neutral";
  const ok =
    sp.ok === "generated" ? t("generated") : sp.ok ? t(`cstatus_${sp.ok}` as "cstatus_approved") : null;

  return (
    <>
      <AdminTitle title={t("creativesTitle")} sub={t("creativesHint")} />
      <AdsNav active="creatives" />
      <Outcome ok={ok} err={sp.err ?? null} />
      <form action={generateCreativesAction} className="flex flex-wrap items-end gap-3" data-generate>
        <label className={labelClass}>
          {t("generateFor")}
          <select name="subcategoryId" className={inputClass}>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm">
          {t("generate")}
        </Button>
      </form>
      {creatives.length === 0 ? (
        <p className="text-[15px] text-stone">{t("noCreatives")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {creatives.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-3 rounded-panel-lg border-[1.5px] border-line-25 p-4"
              data-creative={c.kind}
              data-creative-status={c.status}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-mist">
                  {label(c.subcategoryId)} · {c.kind === "image" ? c.size : t("videoScript")}
                </span>
                <Chip tone={tone(c.status)}>{t(`cstatus_${c.status}` as "cstatus_draft")}</Chip>
              </div>
              {c.kind === "image" ? (
                <img
                  src={`/api/admin/creatives/${c.id}`}
                  alt={`${c.headline} — ${c.size}`}
                  className="h-auto w-full rounded-control border border-line-25"
                  loading="lazy"
                />
              ) : (
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-[15px] text-mist">
                  {(c.script ?? []).map((s, i) => (
                    <li key={i}>
                      <strong>{s.onScreen}</strong> · {t("seconds", { seconds: s.seconds })} —{" "}
                      <span className="text-stone">{s.visual}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-sm text-stone">
                {c.headline} — {c.body}
              </p>
              {c.status === "draft" ? (
                <div className="flex flex-wrap gap-2">
                  <form action={decideCreativeAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <Button type="submit" size="sm">
                      {c.kind === "image" ? t("approveUpload") : t("approve")}
                    </Button>
                  </form>
                  <form action={decideCreativeAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <Button type="submit" variant="outline" size="sm">
                      {t("reject")}
                    </Button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Section title={t("adsTitle")} id="text-ads">
        <Table
          caption={t("adsTitle")}
          head={[t("colGroup"), t("colHeadlines"), t("colDescriptions"), t("colStatus"), t("colSource")]}
          rows={ads.map(({ a, group }) => [
            group,
            <span key="h" className="text-sm">
              {a.headlines.join(" | ")}
            </span>,
            <span key="d" className="text-sm">
              {a.descriptions.join(" | ")}
            </span>,
            t(`status_${a.status}` as "status_draft"),
            a.source,
          ])}
        />
      </Section>
    </>
  );
}
