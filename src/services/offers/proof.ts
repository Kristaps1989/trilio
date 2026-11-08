import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import data from "../../../data/savings.json";
import type { Db } from "@/db/client";
import { isAdminEmail } from "@/config/admin";
import { offerOrders, specialOffers } from "@/db/schema";
import { savedCents, savingsProof, type Saving, type SavingsProof } from "@/domain/offers/proof";
import { MONTHS_LOCATIVE } from "@/domain/social/anonymise";
import { formatEur } from "@/i18n/format";
import { activeLocale } from "@/i18n/active";

// What buyers saved with "Iegūt lētāk" (docs/UX_REVIEW_PLAN.md §6): paid Trilio
// offers against the shop price frozen in each offer, plus savings the owner
// records by hand in data/savings.json. Shown as one anonymous line.

const PAID = ["paid", "packed", "shipped", "delivered"] as const;

type Manual = { subcategoryId: string; savedEur: number; month: string };

/** The hand-kept savings: a month "YYYY-MM" counts as its 1st, so it is never in the future. */
export function manualSavings(list: Manual[] = (data as { savings: Manual[] }).savings): Saving[] {
  return list.flatMap((m) => {
    const at = /^\d{4}-\d{2}$/.test(m.month) ? new Date(`${m.month}-01T12:00:00Z`) : null;
    return at && Number.isFinite(m.savedEur) && m.savedEur > 0
      ? [{ subcategoryId: m.subcategoryId, savedCents: Math.round(m.savedEur * 100), paidAt: at }]
      : [];
  });
}

export async function loadSavingsProof(db: Db): Promise<SavingsProof | null> {
  const rows = await db
    .select({
      subcategoryId: specialOffers.subcategoryId,
      referencePriceCents: specialOffers.referencePriceCents,
      priceCents: specialOffers.priceCents,
      quantity: specialOffers.quantity,
      paidAt: offerOrders.paidAt,
      email: offerOrders.email,
    })
    .from(offerOrders)
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
    .where(and(inArray(offerOrders.status, [...PAID]), isNotNull(offerOrders.paidAt)));
  // The owner's own test purchases (an admin e-mail as the buyer) are not savings.
  const fromOffers = rows.flatMap((r) => {
    if (isAdminEmail(r.email)) return [];
    const saved = savedCents(r);
    return saved === null ? [] : [{ subcategoryId: r.subcategoryId, savedCents: saved, paidAt: r.paidAt! }];
  });
  return savingsProof([...fromOffers, ...manualSavings()]);
}

/** The proof as one sentence in the page's language, or null when there is nothing to show. */
export async function savingsProofText(db: Db): Promise<string | null> {
  const proof = await loadSavingsProof(db).catch(() => null);
  if (!proof) return null;
  const locale = activeLocale();
  const t = await getTranslations("proof");
  const tp = await getTranslations("productType");
  const id = proof.latest.subcategoryId;
  const type = tp.has(id as "fridge") ? tp(id as "fridge") : t("product");
  const monthIndex = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Riga", month: "numeric" }).format(
      proof.latest.paidAt,
    ),
  );
  const month =
    locale === "lv"
      ? MONTHS_LOCATIVE[monthIndex - 1]!
      : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Riga", month: "long" }).format(
          proof.latest.paidAt,
        );
  const amount = formatEur(proof.latest.savedCents);
  return proof.count === 1
    ? t("one", { month, type, amount })
    : t("many", { count: proof.count, total: formatEur(proof.totalCents), month, type, amount });
}
