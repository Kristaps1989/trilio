import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { loadProduct } from "@/db/queries/catalog";
import { NOTHING_REASONS, undecided, type RequestChip } from "@/domain/offers/alternative";
import { formatDateShort, formatEur } from "@/i18n/format";
import { nothingSuggestion, requestersOf } from "@/services/admin/outcomes";
import { shopPrice } from "@/services/offers/alternative";
import { composeNothingEmail } from "@/services/offers/compose-answers";
import { offerMailDeps } from "@/services/offers/deps";
import { Button, ButtonLink } from "@/ui/Button";
import { monitoringAction, nothingAction, waitAction } from "../../outcome-actions";
import { Chip, Section, inputClass, labelClass } from "../../ui";
import { EmailPreview } from "../../piedavajumi/EmailPreview";

// "Atbildes pieprasītājiem" (docs/ALTERNATIVE_OFFER_PLAN.md §3.2): what each person
// who asked was answered, Trilio's suggestion, and the three decisions in one place:
// another maker's product, nothing to offer (with the e-mail it sends), or wait.

const TONE: Record<RequestChip, "lime" | "neutral" | "warning"> = {
  new: "warning",
  requested: "warning",
  offered: "lime",
  alternative_offered: "lime",
  alternative_asked: "neutral",
  nothing_to_offer: "neutral",
  monitoring_only: "neutral",
  ended: "neutral",
};

type Props = {
  productId: string;
  partner: "requested" | "confirmed" | "unavailable" | null;
  status: Record<string, string | undefined>;
};

export async function Answers({ productId, partner, status }: Props) {
  const t = await getTranslations("admin.answers");
  const [people, product, suggestion] = await Promise.all([
    requestersOf(db, productId),
    loadProduct(db, productId),
    nothingSuggestion(db, productId),
  ]);
  if (!product) return null;
  const waiting = people.filter((p) => undecided(p.chip));
  const counts = new Map<RequestChip, number>();
  for (const p of people) counts.set(p.chip, (counts.get(p.chip) ?? 0) + 1);
  const shop = shopPrice(product);
  const first = waiting.find((p) => p.wantsOffers);
  const deps = offerMailDeps();
  const preview = first
    ? composeNothingEmail({
        ...deps,
        to: first.email,
        lang: first.lang,
        askedName: product.name,
        requestedAt: first.requestedAt,
        watchUntil: first.watchUntil,
        shopCents: shop?.cents ?? null,
        unsubscribeUrl: `${deps.baseUrl}/piedavajumi/atteikties/…`,
      })
    : null;
  const decide = waiting.length > 0;
  const direct = waiting.filter((p) => p.direct).length;

  return (
    <Section title={t("title")} id="answers">
      {status.answered ? (
        <p
          role="status"
          className="rounded-panel-lg bg-lime px-4 py-3 text-[15px] font-semibold text-night"
          data-answered={status.answered}
        >
          {t(`done.${status.answered}` as "done.nothing", {
            marked: Number(status.marked ?? 0),
            emailed: Number(status.emailed ?? 0),
            sent: Number(status.sent ?? 0),
            asked: Number(status.asked ?? 0),
          })}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-2" aria-label={t("summary")} data-answer-counts>
        {[...counts.entries()].map(([chip, n]) => (
          <li key={chip}>
            <Chip tone={TONE[chip]}>
              {t(`chip.${chip}`)} · {n}
            </Chip>
          </li>
        ))}
      </ul>

      {decide ? (
        <div
          className="flex flex-col gap-4 rounded-panel-lg border-[1.5px] border-warning p-4"
          data-decision-panel
        >
          <p className="text-[15px] text-mist">
            {t("waiting", { count: waiting.length, direct, ask: waiting.length - direct })}
          </p>
          {suggestion ? (
            <p className="text-[15px] font-semibold text-mist" data-suggestion={suggestion}>
              {t("suggestion", { reason: t(`reason.${suggestion}`) })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <ButtonLink
              href={`/admin/pieprasijums/${productId}/alternativa`}
              size="lg"
              data-testid="offer-alternative"
            >
              {t("offerAlternative")}
            </ButtonLink>
            {partner === "unavailable" ? (
              <form action={waitAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="productId" value={productId} />
                <span className="text-[15px] text-stone">{t("wait")}</span>
                {[7, 14, 30].map((d) => (
                  <Button key={d} type="submit" name="days" value={String(d)} variant="outline" size="sm">
                    {t("waitDays", { days: d })}
                  </Button>
                ))}
              </form>
            ) : null}
          </div>
          <details open={!!suggestion} className="rounded-panel-lg border-[1.5px] border-line-25 p-4">
            <summary className="min-h-11 cursor-pointer text-[15px] font-semibold text-mist">
              {t("nothingTitle")}
            </summary>
            <form action={nothingAction} className="mt-3 flex flex-col gap-3" data-nothing-form>
              <input type="hidden" name="productId" value={productId} />
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-[15px] font-semibold text-mist">{t("reasonLabel")}</legend>
                {NOTHING_REASONS.map((r) => (
                  <label key={r} className="flex min-h-11 items-center gap-3 text-[15px] text-mist">
                    <input
                      type="radio"
                      name="reason"
                      value={r}
                      defaultChecked={r === (suggestion ?? "other")}
                      className="h-5 w-5 accent-lime"
                    />
                    {t(`reason.${r}`)}
                  </label>
                ))}
              </fieldset>
              <label className="flex min-h-11 items-center gap-3 text-[15px] text-mist">
                <input
                  type="checkbox"
                  name="notify"
                  value="1"
                  defaultChecked
                  className="h-5 w-5 accent-lime"
                />
                {t("notify", { count: waiting.filter((p) => p.wantsOffers).length })}
              </label>
              <label className={labelClass}>
                {t("note")}
                <textarea name="note" rows={2} maxLength={1000} className={`${inputClass} py-2`} />
              </label>
              {preview ? (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-[15px] font-semibold text-mist">
                    {t("preview")}
                  </summary>
                  <EmailPreview
                    message={preview}
                    labels={{
                      to: t("previewTo", { email: preview.to }),
                      frame: t("preview"),
                      text: t("textVersion"),
                    }}
                  />
                </details>
              ) : null}
              <div>
                <Button type="submit" data-testid="nothing-submit">
                  {t("nothingSubmit", { count: waiting.length })}
                </Button>
              </div>
            </form>
          </details>
        </div>
      ) : null}

      {people.length ? (
        <form className="flex flex-col gap-3" data-answers-table>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="reason" value="other" />
          <input type="hidden" name="notify" value="1" />
          <div
            tabIndex={0}
            role="group"
            aria-label={t("people")}
            className="overflow-x-auto rounded-panel-lg border-[1.5px] border-line-25"
          >
            <table className="w-full min-w-[620px] border-collapse text-left text-[15px] text-mist">
              <caption className="sr-only">{t("people")}</caption>
              <thead>
                <tr className="border-b border-line-25 text-sm text-stone">
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t("select")}</span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("col.who")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("col.answer")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("col.asked")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("col.seen")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t("col.alternative")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const fixed = p.chip === "offered" || p.chip === "ended";
                  return (
                    <tr key={p.key} className="border-b border-line-20 last:border-0" data-requester={p.chip}>
                      <td className="px-3 py-2 align-top">
                        <label className="flex min-h-11 min-w-11 items-center justify-center">
                          <input
                            type="checkbox"
                            name="keys"
                            value={p.key}
                            disabled={fixed}
                            aria-label={t("selectOne", { email: p.email })}
                            className="h-5 w-5 accent-lime"
                          />
                        </label>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {p.userId ? (
                          <Link
                            href={`/admin/lietotaji/${p.userId}`}
                            className="underline underline-offset-2"
                          >
                            {p.email}
                          </Link>
                        ) : (
                          p.email
                        )}
                        {p.watchUntil ? (
                          <span className="block text-sm text-stone">
                            {t("watchUntil", { date: formatDateShort(p.watchUntil) })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Chip tone={TONE[p.chip]}>{t(`chip.${p.chip}`)}</Chip>
                        {p.outcome?.answer ? (
                          <span className="block text-sm text-stone">{t(`answer.${p.outcome.answer}`)}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top text-sm">
                        {formatDateShort(p.requestedAt ?? p.savedAt)}
                        <span className="block text-stone">
                          {p.requestedAt ? t("requested") : t("saved")}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {p.seenCents !== null ? formatEur(p.seenCents) : "—"}
                      </td>
                      <td className="px-3 py-2 align-top text-sm">
                        {!p.wantsOffers ? t("noOffers") : p.direct ? t("direct") : t("askFirst")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              formAction={nothingAction}
              variant="outline"
              size="sm"
              data-testid="bulk-nothing"
            >
              {t("bulkNothing")}
            </Button>
            <Button
              type="submit"
              formAction={monitoringAction}
              variant="outline"
              size="sm"
              data-testid="bulk-monitoring"
            >
              {t("bulkMonitoring")}
            </Button>
          </div>
          <p className="text-sm text-stone">{t("bulkHint")}</p>
        </form>
      ) : null}
    </Section>
  );
}
