// Edge-of-system formatters. The domain layer works in integer cents and raw
// numbers; only these functions produce user-facing strings.
//
// Latvian rules (CLAUDE.md): decimal comma, a space before €, a thin space as
// the thousands separator ("1 079 €"). English (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md
// §4.3): decimal point, comma separator, € in front ("€1,079"), "Wednesday, 28 October".
//
// Every function takes an optional locale. Without one it uses the request's
// language (activeLocale): server code needs nothing extra; client components
// pass useLocale(), and background jobs pass the recipient's language.

import { activeLocale } from "./active";
import type { UiLocale } from "./routing";

const THIN_SPACE = " "; // narrow no-break space: does not wrap, narrower than a regular space
const NBSP = " ";

const en = (locale?: UiLocale) => (locale ?? activeLocale()) === "en";
const group = (digits: string, locale?: UiLocale) =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, en(locale) ? "," : THIN_SPACE);

export function formatInt(n: number, locale?: UiLocale): string {
  const sign = n < 0 ? "−" : "";
  return sign + group(Math.abs(Math.round(n)).toString(), locale);
}

export function formatNumber(n: number, fractionDigits = 1, locale?: UiLocale): string {
  const fixed = Math.abs(n).toFixed(fractionDigits);
  const [int, frac] = fixed.split(".");
  const sign = n < 0 ? "−" : "";
  const grouped = group(int!, locale);
  return frac ? `${sign}${grouped}${en(locale) ? "." : ","}${frac}` : `${sign}${grouped}`;
}

/**
 * 59900 → "599 €"; 107900 → "1 079 €"; 1990 → "19,90 €". Whole euros drop the cents.
 * English: "€599", "€1,079", "€19.90", "−€180".
 */
export function formatEur(cents: number, locale?: UiLocale): string {
  const whole = cents % 100 === 0;
  const abs = Math.abs(cents);
  if (en(locale)) {
    const body = whole ? formatInt(abs / 100, locale) : formatNumber(abs / 100, 2, locale);
    return `${cents < 0 ? "−" : ""}€${body}`;
  }
  const body = whole ? formatInt(cents / 100, locale) : formatNumber(cents / 100, 2, locale);
  return `${body}${NBSP}€`;
}

/** Signed delta for upgrade lines: 18000 → "+180 €" ("+€180"). */
export function formatEurDelta(cents: number, locale?: UiLocale): string {
  const prefix = cents > 0 ? "+" : "";
  return prefix + formatEur(cents, locale);
}

/** A number as typed, only with the language's decimal mark: 0.5 → "0,5" ("0.5"). For slider values and units. */
export function formatPlain(n: number, locale?: UiLocale): string {
  const s = String(n);
  return en(locale) ? s : s.replace(".", ",");
}

/** 8.6 → "8,6" ("8.6") for ratings. */
export function formatRating(score: number, locale?: UiLocale): string {
  return formatNumber(score, 1, locale);
}

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const enDay = (d: Date) => `${WEEKDAYS_EN[d.getDay()]}, ${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;

const WEEKDAYS_LV = [
  "svētdiena",
  "pirmdiena",
  "otrdiena",
  "trešdiena",
  "ceturtdiena",
  "piektdiena",
  "sestdiena",
];
const WEEKDAYS_LV_DAT = [
  "svētdienai",
  "pirmdienai",
  "otrdienai",
  "trešdienai",
  "ceturtdienai",
  "piektdienai",
  "sestdienai",
];
const MONTHS_LV_DAT = [
  "janvārim",
  "februārim",
  "martam",
  "aprīlim",
  "maijam",
  "jūnijam",
  "jūlijam",
  "augustam",
  "septembrim",
  "oktobrim",
  "novembrim",
  "decembrim",
];
const MONTHS_LV_NOM = [
  "janvāris",
  "februāris",
  "marts",
  "aprīlis",
  "maijs",
  "jūnijs",
  "jūlijs",
  "augusts",
  "septembris",
  "oktobris",
  "novembris",
  "decembris",
];

/** "piegāde līdz trešdienai, 21. oktobrim" needs the dative case. */
export function formatDateDative(d: Date, locale?: UiLocale): string {
  if (en(locale)) return enDay(d);
  return `${WEEKDAYS_LV_DAT[d.getDay()]}, ${d.getDate()}. ${MONTHS_LV_DAT[d.getMonth()]}`;
}

const MONTHS_LV_LOC = [
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

/** "Tu saglabāji to 12. oktobrī": the locative case, without the weekday. */
export function formatDayLocative(d: Date, locale?: UiLocale): string {
  if (en(locale)) return `${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
  return `${d.getDate()}. ${MONTHS_LV_LOC[d.getMonth()]}`;
}

/** Short date for tables: "24.10.2026"; English "24 Oct 2026" (no day/month ambiguity). */
export function formatDateShort(d: Date, locale?: UiLocale): string {
  if (en(locale)) return `${d.getDate()} ${MONTHS_EN[d.getMonth()]!.slice(0, 3)} ${d.getFullYear()}`;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/** Nominative for headings and tables: "trešdiena, 21. oktobris". */
export function formatDateNominative(d: Date, locale?: UiLocale): string {
  if (en(locale)) return enDay(d);
  return `${WEEKDAYS_LV[d.getDay()]}, ${d.getDate()}. ${MONTHS_LV_NOM[d.getMonth()]}`;
}

/** Dimensions: 59.5 → "59,5 cm" ("59.5 cm"). */
export function formatCm(value: number, locale?: UiLocale): string {
  const text = Number.isInteger(value) ? formatInt(value, locale) : formatNumber(value, 1, locale);
  return `${text}${NBSP}cm`;
}

export function formatLitres(value: number, locale?: UiLocale): string {
  return `${formatInt(value, locale)}${NBSP}L`;
}

export function formatDb(value: number, locale?: UiLocale): string {
  return `${formatInt(value, locale)}${NBSP}dB`;
}

/**
 * Grammatical gender of a plural category label, for agreeing adjectives
 * ("Labākie ledusskapji", "Labākās tējkannas"). The head noun is the last
 * word before any " un "; Latvian feminine plurals end in -as, -es or -is,
 * masculine ones in -i.
 */
export function categoryGender(label: string): "f" | "m" {
  const head = label.toLowerCase().split(" un ")[0]!.trim().split(/\s+/).pop() ?? "";
  return /(as|es|is)$/.test(head) ? "f" : "m";
}
