import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { loadProduct, searchProducts } from "@/db/queries/catalog";
import { offerSignature } from "@/config/admin";
import { companyFromEnv, companyLine } from "@/config/company";
import { compareProducts, undecided } from "@/domain/offers/alternative";
import { defaultValidUntil, deliveryOptions } from "@/domain/offers/offers";
import { getSubcategory } from "@/domain/questions/catalog";
import { formatEur } from "@/i18n/format";
import { confirmedCost } from "@/services/admin/crm";
import { requestersOf } from "@/services/admin/outcomes";
import { attrLabel, comparisonWords, shopPrice, suggestionsFor } from "@/services/offers/alternative";
import { referenceFor } from "@/services/offers/reference";
import { appBaseUrl } from "@/services/payments";
import { Button, ButtonLink } from "@/ui/Button";
import { ProductImage } from "@/ui/ProductImage";
import { cardMedia } from "../../../../rezultati/card-media";
import { requireAdmin } from "../../../guard";
import { AdminTitle, Chip, Section, inputClass } from "../../../ui";
import { AltOfferForm } from "./AltOfferForm";

// "Piedāvāt alternatīvu" (docs/ALTERNATIVE_OFFER_PLAN.md §3.3): Trilio's suggestions
// from other makers in ranking order (never by margin), or a search, or a product no
// shop lists; then both side by side, the price checks and the e-mail as it goes out.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alternatīva" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ alt?: string; manual?: string; q?: string }>;
};

const UUID = /^[0-9a-f-]{36}$/i;

function rigaDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Riga" }).format(d);
}

export default async function AlternativePage({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAdmin(`/admin/pieprasijums/${id}/alternativa`);
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("admin.alternative");
  const ta = await getTranslations("admin.answers");
  const sp = await searchParams;
  const original = await loadProduct(db, id);
  if (!original) notFound();
  const sub = getSubcategory(original.subcategoryId);
  const originalShop = shopPrice(original);
  const people = (await requestersOf(db, id)).filter((p) => p.wantsOffers && undecided(p.chip));
  const back = `/admin/pieprasijums/${id}`;
  const base = `${back}/alternativa`;

  const header = (
    <>
      <AdminTitle title={t("title")} sub={t("sub", { name: original.name })}>
        <ButtonLink href={back} variant="outline" size="sm">
          {t("back")}
        </ButtonLink>
      </AdminTitle>
      <p className="text-[15px] text-stone">
        {t("who", { count: people.length, direct: people.filter((p) => p.direct).length })}
      </p>
    </>
  );

  const altId = sp.alt && UUID.test(sp.alt) ? sp.alt : null;
  const manual = sp.manual === "1";

  // Step 1: choose.
  if (!altId && !manual) {
    const suggestions = await suggestionsFor(db, original, originalShop?.cents ?? null);
    const q = (sp.q ?? "").slice(0, 100);
    const found = q
      ? (await searchProducts(db, q, 20)).filter(
          (p) => p.subcategoryId === original.subcategoryId && p.id !== id,
        )
      : [];
    const card = (
      p: (typeof suggestions)[number]["product"],
      cents: number | null,
      comparison: ReturnType<typeof compareProducts>,
    ) => {
      const worse = comparison.lines.filter((l) => l.verdict === "worse" || l.verdict === "different").length;
      const better = comparison.lines.filter((l) => l.verdict === "better").length;
      const { image } = cardMedia(p);
      return (
        <li key={p.id}>
          <Link
            href={`${base}?alt=${p.id}`}
            className="flex min-h-16 items-center gap-4 rounded-panel-lg border-[1.5px] border-line-25 px-4 py-3 text-mist hover:border-lime"
            data-suggestion-id={p.id}
          >
            <ProductImage src={image.src} alt="" fallback={image.fallback} size="thumb" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-semibold">{p.name}</span>
              <span className="text-sm text-stone">
                {p.brand} · {cents !== null ? formatEur(cents) : t("noShop")}
              </span>
              <span className="flex flex-wrap gap-2">
                <Chip tone={comparison.label === "equivalent" ? "lime" : "neutral"}>
                  {t(`label.${comparison.label}`)}
                </Chip>
                {better ? <Chip>{t("better", { count: better })}</Chip> : null}
                {worse ? <Chip tone="warning">{t("worse", { count: worse })}</Chip> : null}
              </span>
            </span>
            <span className="text-sm font-semibold underline underline-offset-2">{t("choose")}</span>
          </Link>
        </li>
      );
    };
    return (
      <>
        {header}
        <Section title={t("suggestions")} id="suggestions">
          <p className="text-sm text-stone">{t("suggestionsHint")}</p>
          {suggestions.length ? (
            <ul className="flex flex-col gap-2" data-suggestions={suggestions.length}>
              {suggestions.map((s) => card(s.product, s.shopCents, s.comparison))}
            </ul>
          ) : (
            <p className="text-[15px] text-stone">{t("noSuggestions")}</p>
          )}
        </Section>
        <Section title={t("search")} id="search">
          <form role="search" action={base} className="flex max-w-xl gap-2">
            <label htmlFor="alt-q" className="sr-only">
              {t("search")}
            </label>
            <input
              id="alt-q"
              name="q"
              defaultValue={q}
              placeholder={t("searchHint")}
              className={inputClass}
            />
            <Button type="submit" variant="outline" size="sm">
              {t("searchButton")}
            </Button>
          </form>
          {q ? (
            found.length ? (
              <ul className="flex flex-col gap-2">
                {found.map((p) =>
                  card(
                    p,
                    shopPrice(p)?.cents ?? null,
                    compareProducts(
                      original.attributes,
                      p.attributes,
                      sub?.compare ?? [],
                      original.subcategoryId,
                    ),
                  ),
                )}
              </ul>
            ) : (
              <p className="text-[15px] text-stone">{t("noResults")}</p>
            )
          ) : null}
        </Section>
        <Section title={t("manualTitle")} id="manual">
          <p className="text-sm text-stone">{t("manualHint")}</p>
          <div>
            <ButtonLink href={`${base}?manual=1`} variant="outline" size="sm" data-testid="manual-product">
              {t("manual")}
            </ButtonLink>
          </div>
        </Section>
      </>
    );
  }

  // Step 2: compare, price, pictures and send.
  const altRef = altId ? await referenceFor(db, altId) : null;
  if (altId && (!altRef || altRef.product.subcategoryId !== original.subcategoryId)) notFound();
  const keys = sub?.compare ?? [];
  const comparison = altRef
    ? compareProducts(original.attributes, altRef.product.attributes, keys, original.subcategoryId)
    : null;
  const words = comparison
    ? comparisonWords({ label: comparison.label, lines: comparison.lines }, original.subcategoryId, "lv")
    : null;
  const seen = people
    .map((p) => p.seenCents ?? originalShop?.cents ?? null)
    .filter((x): x is number => x !== null);
  const originalSeenCents = seen.length ? Math.min(...seen) : null;
  const alt = altRef?.product ?? null;
  const media = alt ? cardMedia(alt).image : null;

  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-panel-lg border-[1.5px] border-line-25 p-4 text-mist">
          <p className="text-sm text-stone">{ta("askedFor")}</p>
          <p className="font-semibold">{original.name}</p>
          <p className="text-sm text-stone">
            {t("seen", { price: originalSeenCents !== null ? formatEur(originalSeenCents) : "—" })}
          </p>
        </div>
        <div className="rounded-panel-lg border-[1.5px] border-lime p-4 text-mist">
          <p className="text-sm text-stone">{ta("offering")}</p>
          <p className="font-semibold">{alt?.name ?? t("manualTitle")}</p>
          {altRef ? (
            <p className="text-sm text-stone">
              {altRef.priceCents !== null
                ? t("altShop", { price: formatEur(altRef.priceCents), store: altRef.storeName ?? "" })
                : t("noShop")}
            </p>
          ) : null}
          <Link href={base} className="text-sm underline underline-offset-2">
            {t("change")}
          </Link>
        </div>
      </div>
      {words && comparison ? (
        <Section title={t("compareTitle")} id="compare">
          <div
            tabIndex={0}
            role="group"
            aria-label={t("compareTitle")}
            className="overflow-x-auto rounded-panel-lg border-[1.5px] border-line-25"
            data-comparison={comparison.label}
          >
            <table className="w-full min-w-[480px] border-collapse text-left text-[15px] text-mist">
              <caption className="sr-only">{t("compareTitle")}</caption>
              <thead>
                <tr className="border-b border-line-25 text-sm text-stone">
                  <th scope="col" className="px-3 py-2">
                    {t("colAttr")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {ta("askedFor")}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {ta("offering")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {words.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line-20 last:border-0">
                    <th scope="row" className="px-3 py-2 font-semibold">
                      {r.label}
                    </th>
                    <td className="px-3 py-2 text-stone">{r.asked}</td>
                    <td className="px-3 py-2">
                      {r.offered}{" "}
                      {r.verdict ? (
                        <Chip
                          tone={
                            r.verdict.tone === "good"
                              ? "lime"
                              : r.verdict.tone === "bad"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {r.verdict.text}
                        </Chip>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[15px] font-semibold text-mist">
            {comparison.label === "equivalent"
              ? t("isEquivalent")
              : t("isSimilar", { list: words.downsides.join("; ") })}
          </p>
        </Section>
      ) : null}
      <AltOfferForm
        original={{
          id: original.id,
          name: original.name,
          subcategoryId: original.subcategoryId,
          attributes: original.attributes,
        }}
        alternative={
          altRef && alt
            ? {
                id: alt.id,
                name: alt.name,
                imageUrl: media?.src ?? null,
                shopCents: altRef.priceCents,
                low30Cents: altRef.low30Cents,
              }
            : null
        }
        comparison={
          comparison && words
            ? { label: comparison.label, rows: words.rows, downsides: words.downsides }
            : null
        }
        manualKeys={alt ? [] : keys.map((k) => ({ key: k, label: attrLabel(k, "lv") }))}
        originalSeenCents={originalSeenCents}
        recipients={people.map((p) => ({
          key: p.key,
          email: p.email,
          direct: p.direct,
          requestedAt: p.requestedAt?.toISOString() ?? null,
          watchUntil: p.watchUntil?.toISOString() ?? null,
        }))}
        imageSetId={randomUUID()}
        signature={offerSignature()}
        inbox={companyFromEnv().email}
        company={companyLine(companyFromEnv())}
        baseUrl={appBaseUrl()}
        defaults={{
          validUntil: rigaDate(defaultValidUntil(new Date())),
          deliveryWorkingDays: deliveryOptions(original.subcategoryId).locker ? 3 : 5,
          warrantyMonths: 24,
          costCents: alt ? await confirmedCost(db, alt.id) : null,
        }}
      />
    </>
  );
}
