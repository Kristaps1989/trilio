import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { adminEmails } from "@/config/admin";
import { formatInt } from "@/i18n/format";
import { offersPaused, recentAudit } from "@/services/admin/audit";
import { eprelCounts, lastRuns } from "@/services/admin/stats";
import { usageSince } from "@/services/llm/client";
import { paymentsProvider } from "@/services/payments";
import { trackersFromEnv } from "@/services/offers/tracking";
import { Button } from "@/ui/Button";
import { retryEprelAction, runIngestAction, toggleOffersPausedAction } from "../actions";
import { requireAdmin } from "../guard";
import { AdminTitle, Chip, Section, Table } from "../ui";

// Sistēma: shops' ingestion, EPREL, Claude API spend, configuration as the
// server sees it (no secrets), the offers kill switch and the audit trail.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sistēma" };

const time = new Intl.DateTimeFormat("lv-LV", {
  timeZone: "Europe/Riga",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

type Props = { searchParams: Promise<{ ingest?: string; eprel?: string }> };

export default async function AdminSystem({ searchParams }: Props) {
  await requireAdmin("/admin/sistema");
  const t = await getTranslations("admin.system");
  const sp = await searchParams;
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [runs, eprel, llmToday, llmMonth, paused, auditRows] = await Promise.all([
    lastRuns(db),
    eprelCounts(db),
    usageSince(db, dayStart),
    usageSince(db, monthStart),
    offersPaused(db),
    recentAudit(db, 30),
  ]);
  const usd = (rows: typeof llmToday) => rows.reduce((n, r) => n + (r.estimatedUsd ?? 0), 0);
  const provider = paymentsProvider();
  const env = process.env;
  const on = (v: boolean) => (v ? <Chip tone="lime">{t("on")}</Chip> : <Chip>{t("off")}</Chip>);

  return (
    <>
      <AdminTitle title={t("title")} />
      {sp.ingest ? (
        <p role="status" className="rounded-[14px] bg-lime-12 px-4 py-3 text-mist">
          {t("ingestStarted")}
        </p>
      ) : null}
      {sp.eprel ? (
        <p role="status" className="rounded-[14px] bg-lime-12 px-4 py-3 text-mist">
          {t("eprelRetried", { count: Number(sp.eprel) || 0 })}
        </p>
      ) : null}

      <Section title={t("offersMail")} id="kill">
        <div className="flex flex-wrap items-center gap-3">
          {paused ? <Chip tone="warning">{t("paused")}</Chip> : <Chip tone="lime">{t("running")}</Chip>}
          <form action={toggleOffersPausedAction}>
            <Button type="submit" variant={paused ? "primary" : "danger"} size="sm">
              {paused ? t("resume") : t("pause")}
            </Button>
          </form>
        </div>
        <p className="text-sm text-stone">{t("pauseHint")}</p>
      </Section>

      <Section title={t("ingestion")} id="ingestion">
        <Table
          caption={t("ingestion")}
          head={[t("shop"), t("lastRun"), t("result"), ""]}
          empty={t("noShops")}
          rows={runs.map((r) => [
            <span key="n" className="font-semibold">
              {r.storeName}
              <span className="block text-sm font-normal text-stone">{r.feedType}</span>
            </span>,
            r.startedAt ? time.format(r.startedAt) : "—",
            r.ok === null || r.ok === undefined ? (
              r.startedAt ? (
                t("running")
              ) : (
                "—"
              )
            ) : r.ok ? (
              t("ok", { upserted: formatInt(r.rowsUpserted ?? 0), rejected: formatInt(r.rowsRejected ?? 0) })
            ) : (
              <span key="e" className="text-warning">
                {r.error ?? t("failed")}
              </span>
            ),
            <form key="f" action={runIngestAction}>
              <input type="hidden" name="storeId" value={r.storeId} />
              <Button type="submit" variant="outline" size="sm">
                {t("runNow")}
              </Button>
            </form>,
          ])}
        />
      </Section>

      <Section
        title={t("eprel")}
        id="eprel"
        action={
          eprel.error ? (
            <form action={retryEprelAction}>
              <Button type="submit" variant="outline" size="sm">
                {t("retry", { count: eprel.error })}
              </Button>
            </form>
          ) : null
        }
      >
        <p className="text-[15px] text-mist">
          {t("eprelCounts", {
            found: eprel.found ?? 0,
            notFound: eprel.not_found ?? 0,
            error: eprel.error ?? 0,
          })}
        </p>
      </Section>

      <Section title={t("llm")} id="llm">
        <p className="text-[15px] text-mist">
          {t("llmSpend", { today: usd(llmToday).toFixed(2), month: usd(llmMonth).toFixed(2) })}
        </p>
        <Table
          caption={t("llm")}
          head={[t("purpose"), t("model"), t("calls"), t("cache"), t("usd")]}
          empty={t("noLlm")}
          rows={llmMonth.map((r) => [
            r.purpose,
            r.model,
            `${formatInt(r.calls)}${r.failed ? ` (${r.failed} ✕)` : ""}`,
            r.cacheHitRate === null ? "—" : `${Math.round(r.cacheHitRate * 100)}%`,
            r.estimatedUsd === null ? "—" : `$${r.estimatedUsd.toFixed(2)}`,
          ])}
        />
      </Section>

      <Section title={t("config")} id="config">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px] text-mist">
          <dt className="text-stone">{t("payments")}</dt>
          <dd>{provider ? <Chip tone="lime">{provider.name}</Chip> : <Chip>{t("paymentsOff")}</Chip>}</dd>
          <dt className="text-stone">{t("email")}</dt>
          <dd>{on(!!env.RESEND_API_KEY)}</dd>
          <dt className="text-stone">{t("vat")}</dt>
          <dd>{env.COMPANY_VAT_NO ? env.COMPANY_VAT_NO : <Chip>{t("noVat")}</Chip>}</dd>
          <dt className="text-stone">{t("tracking")}</dt>
          <dd>
            {trackersFromEnv()
              .map((x) => x.carrier)
              .join(", ") || t("none")}
          </dd>
          <dt className="text-stone">{t("freeText")}</dt>
          <dd>{on(env.FEATURE_FREE_TEXT_LLM === "1")}</dd>
          <dt className="text-stone">{t("extract")}</dt>
          <dd>{on(env.FEATURE_LLM_EXTRACT === "1")}</dd>
          <dt className="text-stone">{t("model")}</dt>
          <dd>{env.LLM_MODEL || "—"}</dd>
          <dt className="text-stone">{t("analytics")}</dt>
          <dd>{on(!!env.GA_MEASUREMENT_ID)}</dd>
          <dt className="text-stone">{t("admins")}</dt>
          <dd className="break-all">{adminEmails().join(", ")}</dd>
          {env.ALLOW_INSECURE_TEST_FEATURES === "1" ? (
            <>
              <dt className="text-stone">{t("insecure")}</dt>
              <dd>
                <Chip tone="warning">{t("insecureOn")}</Chip>
              </dd>
            </>
          ) : null}
        </dl>
      </Section>

      <Section title={t("audit")} id="audit">
        <Table
          caption={t("audit")}
          head={[t("when"), t("who"), t("what"), t("target")]}
          empty={t("noAudit")}
          rows={auditRows.map((a) => [
            time.format(a.createdAt),
            a.adminEmail,
            a.action,
            `${a.targetType ?? ""} ${a.targetId?.slice(0, 8) ?? ""}`,
          ])}
        />
      </Section>
    </>
  );
}
