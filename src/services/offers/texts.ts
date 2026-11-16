import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import { isUiLocale, type UiLocale } from "@/i18n/routing";

// Copy for offer and order e-mails in the buyer's language (users.locale),
// read from the message files so jobs work without a request context (like
// services/texts.ts).

export const offerCopy = lv.offerEmail;

export function offerCopyFor(lang: UiLocale = "lv"): typeof lv.offerEmail {
  return lang === "en" ? en.offerEmail : lv.offerEmail;
}

/** Copy for Trilio's answers that are not an offer for the product asked for (docs/ALTERNATIVE_OFFER_PLAN.md). */
export function answerCopyFor(lang: UiLocale = "lv"): typeof lv.answerEmail {
  return lang === "en" ? en.answerEmail : lv.answerEmail;
}

/** The language a user's e-mails are written in; Latvian without an account. */
export async function userLang(db: Db, userId: string | null | undefined): Promise<UiLocale> {
  if (!userId) return "lv";
  const [row] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  return isUiLocale(row?.locale) ? row.locale : "lv";
}

export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}
