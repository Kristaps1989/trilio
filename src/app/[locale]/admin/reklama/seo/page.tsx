import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatInt } from "@/i18n/format";
import { dayOffset } from "@/services/ads/account";
import { seoChanges } from "@/services/seo/agent";
import { seoOpportunities } from "@/services/seo/search-console";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Section, Table } from "../../ui";
import { decideSeoAction, runSeoAgentAction, seoDoneAction } from "../actions";
import { AdsNav, Outcome } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SEO · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsSeo({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/seo");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const rows = await seoOpportunities(db, dayOffset(new Date(), 28));
  const changes = await seoChanges(db);
  const ran = sp.ran?.split("/").map(Number);
  const pct = (n: { impressions: number; clicks: number }) =>
    n.impressions ? `${((100 * n.clicks) / n.impressions).toFixed(1).replace(".", ",")} %` : "—";
  const tone = (s: string) =>
    s === "active" || s === "kept" ? "lime" : s === "proposed" ? "warning" : "neutral";
  return (
    <>
      <AdminTitle title={t("seoTitle")} sub={t("seoHint")} />
      <AdsNav active="seo" />
      <Outcome
        ok={
          ran
            ? t("seoRan", {
                written: ran[0] ?? 0,
                applied: ran[1] ?? 0,
                refused: ran[2] ?? 0,
                kept: ran[3] ?? 0,
                reverted: ran[4] ?? 0,
              })
            : sp.ok
              ? t("done")
              : null
        }
        err={sp.err ? t("seoErr") : null}
      />
      <Section title={t("seoAgentTitle")} id="seo-agent">
        <p className="max-w-2xl text-[15px] text-stone">{t("seoAgentIntro")}</p>
        <form action={runSeoAgentAction}>
          <Button type="submit" variant="outline" size="sm">
            {t("seoRunNow")}
          </Button>
        </form>
        <Table
          caption={t("seoAgentTitle")}
          head={[
            t("colPage"),
            t("seoColText"),
            t("seoColBefore"),
            t("seoColAfter"),
            t("colState"),
            t("colActions"),
          ]}
          empty={t("seoAgentEmpty")}
          rows={changes.map((c) => [
            <span key="p" data-seo-change={c.status} className="text-sm break-all">
              {c.path}
              <span className="block text-stone">{c.query}</span>
            </span>,
            <span key="t" className="text-sm break-words">
              <span className="block font-semibold text-mist">{c.title}</span>
              {c.description}
              {c.why ? <span className="block text-stone">{c.why}</span> : null}
            </span>,
            <span key="b" className="text-sm whitespace-nowrap">
              {pct(c.before)} · {String(c.before.position).replace(".", ",")}
            </span>,
            <span key="a" className="text-sm whitespace-nowrap">
              {c.after ? `${pct(c.after)} · ${String(c.after.position).replace(".", ",")}` : "—"}
            </span>,
            <Chip key="s" tone={tone(c.status)}>
              {t(`seoStatus_${c.status}` as "seoStatus_active")}
            </Chip>,
            c.status === "proposed" ? (
              <span key="d" className="flex flex-wrap gap-2">
                {(["approve", "reject"] as const).map((d) => (
                  <form key={d} action={decideSeoAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="decision" value={d} />
                    <Button type="submit" variant={d === "approve" ? "primary" : "outline"} size="sm">
                      {t(d === "approve" ? "seoApprove" : "seoReject")}
                    </Button>
                  </form>
                ))}
              </span>
            ) : c.status === "active" || c.status === "kept" ? (
              <form key="d" action={decideSeoAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="decision" value="revert" />
                <Button type="submit" variant="outline" size="sm">
                  {t("seoRevert")}
                </Button>
              </form>
            ) : (
              ""
            ),
          ])}
        />
      </Section>
      <Table
        caption={t("seoTitle")}
        head={[
          t("colQuery"),
          t("colPage"),
          t("colImpressions"),
          t("colClicks28"),
          t("colPosition"),
          t("colActions"),
        ]}
        empty={t("noSeo")}
        rows={rows.map((r) => [
          <span key="q" data-seo-query={r.query}>
            {r.query}
          </span>,
          r.page,
          formatInt(Number(r.impressions)),
          formatInt(Number(r.clicks)),
          String(r.position).replace(".", ","),
          r.done ? (
            <Chip tone="lime">{t("done")}</Chip>
          ) : (
            <form key="d" action={seoDoneAction}>
              <input type="hidden" name="query" value={r.query} />
              <input type="hidden" name="page" value={r.page} />
              <Button type="submit" variant="outline" size="sm">
                {t("markDone")}
              </Button>
            </form>
          ),
        ])}
      />
    </>
  );
}
