// Product photos and EPREL energy-label links (docs/PICTURES_AND_LLM_PLAN.md).
// Pure: the card builders decide what to show; the UI only renders it.

/** Local photos of the design sample data (public/sample); never in shop data. */
export const SAMPLE_PATH = /^\/sample\/[a-z0-9-]+\.(png|jpg|webp)$/;

/**
 * True when `host` matches one of the store image hosts ("cdn.tet.lv",
 * "*.m79.lv"). Like next/image remotePatterns, "*" is one subdomain label.
 */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const q = p.toLowerCase();
    if (!q.startsWith("*.")) return h === q;
    const rest = h.slice(0, -(q.length - 1));
    return h.endsWith(q.slice(1)) && /^[^.]+$/.test(rest);
  });
}

/**
 * The photo URL to render, or null: only https photos on an allowed store
 * host go through the image optimiser (anything else would make it throw).
 */
export function imageSrc(url: string | null | undefined, patterns: readonly string[]): string | null {
  if (!url) return null;
  if (SAMPLE_PATH.test(url)) return url;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && hostAllowed(u.hostname, patterns)
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

export type EnergyLabel = {
  energyClass: string;
  /** The official label image. */
  labelUrl: string;
  /** The product information sheet, in Latvian. */
  sheetUrl: string;
};

const EPREL = "https://eprel.ec.europa.eu/api/products";

/** Value stored in products.eprel_id: "<product group>/<registration number>". */
export function eprelId(group: string, registrationNumber: string): string {
  return `${group}/${registrationNumber}`;
}

/**
 * EPREL's label and sheet for a product matched in EPREL, with the class the
 * product carries; null without a match or a class.
 */
export function energyLabel(id: string | null | undefined, energyClass: unknown): EnergyLabel | null {
  const m = /^([a-z0-9]+)\/(\d+)$/.exec(id ?? "");
  if (!m || typeof energyClass !== "string" || !/^[A-G]$/.test(energyClass)) return null;
  const base = `${EPREL}/${m[1]}/${m[2]}`;
  return {
    energyClass,
    labelUrl: `${base}/labels?format=PNG`,
    sheetUrl: `${base}/fiches?language=LV`,
  };
}
