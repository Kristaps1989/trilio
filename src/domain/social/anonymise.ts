// Nothing that identifies a shopper leaves the database (docs/SOCIAL_PLAN.md §5).
// A post about a real offer is built only from the allowed fields below;
// `leaks` is the last check that none of the person's values slipped in.

const MONTHS_LOCATIVE = [
  "janvārī",
  "februārī",
  "martā",
  "aprīlī",
  "maijā",
  "jūnijā",
  "jūlijā",
  "augustā",
  "septembrī",
  "oktobrī",
  "novembrī",
  "decembrī",
];

export type OfferStory = {
  product: string;
  shop: string | null;
  shopPriceCents: number | null;
  trilioPriceCents: number;
  deliveryDays: number;
  /** "oktobrī": the month only, never the day. */
  month: string;
};

/** The allowed facts of a paid offer; every other field of the record is dropped. */
export function offerStory(r: {
  productName: string;
  referenceStoreName: string | null;
  referencePriceCents: number | null;
  priceCents: number;
  deliveryWorkingDays: number;
  paidAt: Date;
}): OfferStory {
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Riga", month: "numeric" }).format(
    r.paidAt,
  );
  return {
    product: r.productName,
    shop: r.referenceStoreName,
    shopPriceCents: r.referencePriceCents,
    trilioPriceCents: r.priceCents,
    deliveryDays: r.deliveryWorkingDays,
    month: MONTHS_LOCATIVE[Number(month) - 1]!,
  };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKC");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The personal values found in a text: names and e-mails as words, phone and
 * order numbers also with other spacing or punctuation. Values shorter than 3
 * characters are ignored; text longer than four words is matched only whole.
 */
export function leaks(text: string, personal: (string | null | undefined)[]): string[] {
  const hay = norm(text);
  const flat = hay.replace(/[^\p{L}\p{N}]/gu, "");
  const found: string[] = [];
  for (const raw of personal) {
    if (!raw) continue;
    // Names and addresses also word by word; longer free text (a note, a greeting) only as a whole.
    const words = raw.split(/[\s,]+/).filter(Boolean);
    for (const part of [raw, ...(words.length <= 4 ? words : [])]) {
      const v = norm(part.trim());
      if (v.length < 3) continue;
      const compact = v.replace(/[^\p{L}\p{N}]/gu, "");
      const word = new RegExp(`(?<![\\p{L}\\p{N}])${escape(v)}(?![\\p{L}\\p{N}])`, "u");
      if (word.test(hay) || (/\d{3,}/.test(compact) && flat.includes(compact))) {
        found.push(part.trim());
        break;
      }
    }
  }
  return found;
}
