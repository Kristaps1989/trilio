import type { Metadata } from "next";
import { desc, eq, ne } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { adChanges, adProposals, db } from "@/db";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Section, Table } from "../../ui";
import { decideProposalAction } from "../actions";
import { AdsNav, Outcome } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Priekšlikumi · Reklāma" };

const time = new Intl.DateTimeFormat("lv-LV", {
  timeZone: "Europe/Riga",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** What a proposal changes, in one line. */
function details(params: Record<string, unknown>): string {
  const { action: _a, ...rest } = params;
  void _a;
  return Object.entries(rest)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" | ") : String(v)}`)
    .join(" · ");
}

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsProposals({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/priekslikumi");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const waiting = await db
    .select()
    .from(adProposals)
    .where(eq(adProposals.status, "proposed"))
    .orderBy(desc(adProposals.createdAt))
    .limit(100);
  const history = await db
    .select()
    .from(adProposals)
    .where(ne(adProposals.status, "proposed"))
    .orderBy(desc(adProposals.createdAt))
    .limit(60);
  const changes = await db.select().from(adChanges).orderBy(desc(adChanges.createdAt)).limit(40);
  const action = (a: string) => t(`action_${a}` as "action_add_negative");
  const tone = (s: string) =>
    s === "applied" ? "lime" : s === "blocked" || s === "failed" ? "warning" : "neutral";

  return (
    <>
      <AdminTitle title={t("proposalsTitle")} />
      <AdsNav active="proposals" />
      <Outcome ok={sp.ok ? t(`pstatus_${sp.ok}` as "pstatus_applied") : null} err={sp.err ?? null} />
      <Table
        caption={t("proposalsTitle")}
        head={[
          t("colAction"),
          t("colDetails"),
          t("colReason"),
          t("colEffect"),
          t("colConfidence"),
          t("colDecision"),
        ]}
        empty={t("noProposals")}
        rows={waiting.map((p) => [
          <span key="a" data-proposal={p.action}>
            {action(p.action)}
          </span>,
          <span key="d" className="text-sm break-words">
            {details(p.params)}
          </span>,
          p.reason,
          p.expectedEffect ?? "—",
          p.confidence === null ? "—" : `${p.confidence}`,
          <div key="b" className="flex flex-wrap gap-2">
            <form action={decideProposalAction}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="decision" value="approve" />
              <Button type="submit" size="sm">
                {t("approve")}
              </Button>
            </form>
            <form action={decideProposalAction}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="decision" value="reject" />
              <Button type="submit" variant="outline" size="sm">
                {t("reject")}
              </Button>
            </form>
          </div>,
        ])}
      />
      <Section title={t("historyTitle")} id="history">
        <Table
          caption={t("historyTitle")}
          head={[t("colWhen"), t("colAction"), t("colDetails"), t("colStatus"), t("colReason")]}
          rows={history.map((p) => [
            time.format(p.decidedAt ?? p.createdAt),
            action(p.action),
            <span key="d" className="text-sm break-words">
              {details(p.params)}
            </span>,
            <Chip key="s" tone={tone(p.status)}>
              {t(`pstatus_${p.status}` as "pstatus_applied")}
            </Chip>,
            <span key="r" data-history-status={p.status}>
              {p.blockReason ?? p.reason}
            </span>,
          ])}
        />
      </Section>
      <Section title={t("changesTitle")} id="changes">
        <Table
          caption={t("changesTitle")}
          head={[t("colWhen"), t("colOperation"), t("colResult")]}
          rows={changes.map((c) => [
            time.format(c.createdAt),
            <span key="o" className="text-sm break-words">
              {String((c.operation as { op?: string }).op)} {details(c.operation)}
            </span>,
            c.ok ? <Chip tone="lime">OK</Chip> : <Chip tone="warning">{c.response ?? "—"}</Chip>,
          ])}
        />
      </Section>
    </>
  );
}
