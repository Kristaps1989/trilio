import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { adAgentRuns, db } from "@/db";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, inputClass, labelClass, Section, Table } from "../../ui";
import { memoNoteAction } from "../actions";
import { AdsNav, Outcome } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stratēģija · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsStrategy({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/strategija");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const memos = await db
    .select()
    .from(adAgentRuns)
    .where(eq(adAgentRuns.kind, "weekly"))
    .orderBy(desc(adAgentRuns.day))
    .limit(8);
  const runs = await db
    .select()
    .from(adAgentRuns)
    .where(eq(adAgentRuns.kind, "daily"))
    .orderBy(desc(adAgentRuns.day))
    .limit(30);
  const latest = memos[0];

  return (
    <>
      <AdminTitle title={t("strategyTitle")} />
      <AdsNav active="strategy" />
      <Outcome ok={sp.ok ? t("saved") : null} />
      {latest ? (
        <Section title={latest.day} id="memo">
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-mist" data-memo>
            {latest.memo}
          </div>
          <form action={memoNoteAction} className="flex max-w-2xl flex-col gap-2">
            <input type="hidden" name="id" value={latest.id} />
            <label className={labelClass}>
              {t("ownerNote")}
              <textarea
                name="note"
                rows={3}
                defaultValue={latest.ownerNote ?? ""}
                className={`${inputClass} py-2`}
              />
            </label>
            <div>
              <Button type="submit" variant="outline" size="sm">
                {t("saveNote")}
              </Button>
            </div>
          </form>
        </Section>
      ) : (
        <p className="text-[15px] text-stone">{t("noMemo")}</p>
      )}
      <Section title={t("runsTitle")} id="runs">
        <Table
          caption={t("runsTitle")}
          head={[t("colDay"), t("colStatus"), t("colSummary"), t("colCounts")]}
          empty={t("noRun")}
          rows={runs.map((r) => [
            r.day,
            r.ok ? <Chip tone="lime">OK</Chip> : <Chip tone="warning">{r.error ?? "—"}</Chip>,
            <span key="s" className="text-sm">
              {r.summary ?? "—"}
            </span>,
            `${r.proposals} / ${r.applied} / ${r.blocked}`,
          ])}
        />
      </Section>
    </>
  );
}
