// Product identity (CLAUDE.md rule 3): same product = same EAN (GTIN); fall
// back to brand + normalised model code. Pure functions, no imports.

/** GTIN check digit (mod 10, weights 3/1 from the right). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Normalise an EAN/GTIN/UPC string to GTIN-13 (or GTIN-14 for 14-digit codes).
 * Returns null when the string is not a valid GTIN-8/12/13/14 with a correct
 * check digit. UPC-A (12) and GTIN-8 are zero-padded to 13.
 */
export function normalizeEan(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const digits = String(input).replace(/[^0-9]/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  if (/^0+$/.test(digits)) return null;
  const body = digits.slice(0, -1);
  if (gtinCheckDigit(body) !== Number(digits.at(-1))) return null;
  return digits.length === 14 ? digits : digits.padStart(13, "0");
}

/** "KGN39VLCT" and "kgn 39-vlct" are the same model. */
export function normalizeModelCode(code: string): string {
  return code
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeBrand(brand: string): string {
  return brand.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Fallback identity when no EAN is available. */
export function modelKey(brand: string, modelCode: string): string {
  return `${normalizeBrand(brand)}:${normalizeModelCode(modelCode)}`;
}

/** First word of a product name is the brand in the sample data and most feeds ("Bosch Serie 4 …"). */
export function brandFromName(name: string): string {
  return name.split(/[\s,]+/)[0] ?? "";
}
