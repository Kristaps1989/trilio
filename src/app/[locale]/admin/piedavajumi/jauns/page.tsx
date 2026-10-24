import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db, savedItems, users } from "@/db";
import { searchProducts } from "@/db/queries/catalog";
import { offerSignature } from "@/config/admin";
import { companyFromEnv } from "@/config/company";
import { defaultValidUntil, deliveryOptions, vatRateFor } from "@/domain/offers/offers";
import { getSubcategory } from "@/domain/questions/catalog";
import { formatEur } from "@/i18n/format";
import { saversOf } from "@/services/admin/stats";
import { referenceFor } from "@/services/offers/reference";
import { appBaseUrl } from "@/services/payments";
import { Button } from "@/ui/Button";
import { ProductImage } from "@/ui/ProductImage";
import { cardMedia } from "../../../rezultati/card-media";
import { requireAdmin } from "../../guard";
import { AdminTitle, Section, inputClass } from "../../ui";
import { OfferForm, type Recipient } from "./OfferForm";

// New offer: pick the product (from a user's saved items, the demand list,
// or a search), pick who gets it, type the price.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jauns piedāvājums" };

type Props = {
  searchParams: Promise<{ product?: string; user?: string; all?: string; q?: string; uq?: string }>;
};

const UUID = /^[0-9a-f-]{36}$/i;

function rigaDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Riga" }).format(d);
}

export default async function NewOffer({ searchParams }: Props) {
  await requireAdmin("/admin/piedavajumi/jauns");
  const t = await getTranslations("admin.offerForm");
  const sp = await searchParams;
  const productId = sp.product && UUID.test(sp.product) ? sp.product : null;
  const userId = sp.user && UUID.test(sp.user) ? sp.user : null;
  const keep = (extra: Record<string, string>) =>
    `/admin/piedavajumi/jauns?${new URLSearchParams({
      ...(productId ? { product: productId } : {}),
      ...(userId ? { user: userId } : {}),
      ...(sp.all ? { all: "1" } : {}),
      ...extra,
    })}`;

  const reference = productId ? await referenceFor(db, productId) : null;

  // Step 1: the product.
  if (!reference) {
    const q = (sp.q ?? "").slice(0, 100);
    const found = q ? await searchProducts(db, q, 10) : [];
    return (
      <>
        <AdminTitle title={t("title")} sub={t("pickProduct")} />
        <form role="search" action="/admin/piedavajumi/jauns" className="flex max-w-xl gap-2">
          {userId ? <input type="hidden" name="user" value={userId} /> : null}
          <label htmlFor="product-q" className="sr-only">
            {t("productSearch")}
          </label>
          <input
            id="product-q"
            name="q"
            defaultValue={q}
            placeholder={t("productSearch")}
            className={inputClass}
          />
          <Button type="submit" variant="outline" size="sm">
            {t("search")}
          </Button>
        </form>
        <ul className="flex flex-col gap-2">
          {found.map((p) => (
            <li key={p.id}>
              <Link
                href={keep({ product: p.id })}
                className="flex min-h-14 items-center justify-between gap-3 rounded-panel-lg border-[1.5px] border-line-25 px-4 py-3 text-mist hover:border-lime"
              >
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm text-stone">{p.ean ?? p.modelCode}</span>
              </Link>
            </li>
          ))}
          {q && found.length === 0 ? <li className="text-stone">{t("noProducts")}</li> : null}
        </ul>
      </>
    );
  }

  const { product } = reference;
  // Step 2: who gets it. A user from their page, everyone who saved it, or a search by e-mail.
  let people: { id: string; email: string; optIn: boolean }[] = [];
  if (sp.all)
    people = (await saversOf(db, product.id)).map((p) => ({ id: p.id, email: p.email, optIn: p.optIn }));
  else if (userId)
    people = await db
      .select({ id: users.id, email: users.email, optIn: users.offersOptIn })
      .from(users)
      .where(eq(users.id, userId));
  const uq = (sp.uq ?? "").trim().slice(0, 100);
  const userMatches =
    !people.length && uq
      ? await db
          .select({ id: users.id, email: users.email, optIn: users.offersOptIn })
          .from(users)
          .where(or(ilike(users.email, `%${uq}%`), ilike(users.name, `%${uq}%`)))
          .limit(10)
      : [];

  const saved = people.length
    ? await db
        .select({
          userId: savedItems.userId,
          at: savedItems.createdAt,
          priceCents: savedItems.baselinePriceCents,
        })
        .from(savedItems)
        .where(
          and(
            eq(savedItems.productId, product.id),
            inArray(
              savedItems.userId,
              people.map((p) => p.id),
            ),
          ),
        )
    : [];
  const savedBy = new Map(saved.map((s) => [s.userId, s]));
  const recipients: Recipient[] = people.map((p) => {
    const s = savedBy.get(p.id);
    return { ...p, saved: s ? { at: s.at.toISOString(), priceCents: s.priceCents } : null };
  });
  const { image } = cardMedia(product);
  const large = !deliveryOptions(product.subcategoryId).locker;

  return (
    <>
      <AdminTitle title={t("title")} />
      <div className="flex items-center gap-4 rounded-panel-lg border-[1.5px] border-line-25 p-4">
        <ProductImage src={image.src} alt={product.name} fallback={image.fallback} size="thumb" />
        <div className="min-w-0">
          <p className="text-lg font-bold text-mist">{product.name}</p>
          <p className="text-sm text-stone">
            {getSubcategory(product.subcategoryId)?.label ?? product.subcategoryId} ·{" "}
            {product.ean ?? product.modelCode}
            {reference.priceCents !== null ? ` · ${formatEur(reference.priceCents)}` : ""}
          </p>
          <Link
            href={`/admin/piedavajumi/jauns${userId ? `?user=${userId}` : ""}`}
            className="text-sm underline underline-offset-2"
          >
            {t("otherProduct")}
          </Link>
        </div>
      </div>

      {recipients.length === 0 ? (
        <Section title={t("pickRecipient")} id="recipient">
          <form role="search" action="/admin/piedavajumi/jauns" className="flex max-w-xl gap-2">
            <input type="hidden" name="product" value={product.id} />
            <label htmlFor="user-q" className="sr-only">
              {t("userSearch")}
            </label>
            <input
              id="user-q"
              name="uq"
              defaultValue={uq}
              placeholder={t("userSearch")}
              className={inputClass}
            />
            <Button type="submit" variant="outline" size="sm">
              {t("search")}
            </Button>
          </form>
          <ul className="flex flex-col gap-2">
            {userMatches.map((u) => (
              <li key={u.id}>
                <Link
                  href={keep({ product: product.id, user: u.id })}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-panel-lg border-[1.5px] border-line-25 px-4 py-2 text-mist hover:border-lime"
                >
                  <span>{u.email}</span>
                  <span className="text-sm text-stone">{u.optIn ? t("consent") : t("noConsent")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <OfferForm
          product={{ id: product.id, name: product.name }}
          reference={{
            priceCents: reference.priceCents,
            storeName: reference.storeName,
            low30Cents: reference.low30Cents,
          }}
          recipients={recipients}
          vatRate={vatRateFor(companyFromEnv().vatNo)}
          signature={offerSignature()}
          baseUrl={appBaseUrl()}
          defaults={{
            validUntil: rigaDate(defaultValidUntil(new Date())),
            deliveryWorkingDays: large ? 5 : 3,
            warrantyMonths: 24,
          }}
        />
      )}
    </>
  );
}
