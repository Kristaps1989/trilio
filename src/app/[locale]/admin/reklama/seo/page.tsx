import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatInt } from "@/i18n/format";
import { dayOffset } from "@/services/ads/account";
import { seoOpportunities } from "@/services/seo/search-console";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Table } from "../../ui";
import { seoDoneAction } from "../actions";
import { AdsNav, Outcome } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SEO · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsSeo({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/seo");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const rows = await seoOpportunities(db, dayOffset(new Date(), 28));
  return (
    <>
      <AdminTitle title={t("seoTitle")} sub={t("seoHint")} />
      <AdsNav active="seo" />
      <Outcome ok={sp.ok ? t("done") : null} />
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
