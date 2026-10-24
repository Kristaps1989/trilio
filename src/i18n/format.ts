// Edge-of-system formatters. The domain layer works in integer cents and raw
// numbers; only these functions produce user-facing strings.
//
// Latvian rules (CLAUDE.md): decimal comma, a space before €, a thin space as
// the thousands separator ("1 079 €").

const THIN_SPACE = " "; // narrow no-break space: does not wrap, narrower than a regular space
const NBSP = " ";

export function formatInt(n: number): string {
  const sign = n < 0 ? "−" : "";
  const digits = Math.abs(Math.round(n)).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

export function formatNumber(n: number, fractionDigits = 1): string {
  const fixed = Math.abs(n).toFixed(fractionDigits);
  const [int, frac] = fixed.split(".");
  const sign = n < 0 ? "−" : "";
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  return frac ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

/** 59900 → "599 €"; 107900 → "1 079 €"; 1990 → "19,90 €". Whole euros drop the cents. */
export function formatEur(cents: number): string {
  const whole = cents % 100 === 0;
  const body = whole ? formatInt(cents / 100) : formatNumber(cents / 100, 2);
  return `${body}${NBSP}€`;
}

/** Signed delta for upgrade lines: 18000 → "+180 €". */
export function formatEurDelta(cents: number): string {
  const prefix = cents > 0 ? "+" : "";
  return prefix + formatEur(cents);
}

/** 8.6 → "8,6" for ratings. */
export function formatRating(score: number): string {
  return formatNumber(score, 1);
}

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
export function formatDateDative(d: Date): string {
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
export function formatDayLocative(d: Date): string {
  return `${d.getDate()}. ${MONTHS_LV_LOC[d.getMonth()]}`;
}

/** Short numeric date for tables: "24.10.2026". */
export function formatDateShort(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/** Nominative for headings and tables: "trešdiena, 21. oktobris". */
export function formatDateNominative(d: Date): string {
  return `${WEEKDAYS_LV[d.getDay()]}, ${d.getDate()}. ${MONTHS_LV_NOM[d.getMonth()]}`;
}

/** Dimensions: 59.5 → "59,5 cm". */
export function formatCm(value: number): string {
  const text = Number.isInteger(value) ? formatInt(value) : formatNumber(value, 1);
  return `${text}${NBSP}cm`;
}

export function formatLitres(value: number): string {
  return `${formatInt(value)}${NBSP}L`;
}

export function formatDb(value: number): string {
  return `${formatInt(value)}${NBSP}dB`;
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
