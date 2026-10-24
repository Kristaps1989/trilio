// Which visits came from an ad (docs/GROWTH_PLAN.md, Phase 0). Only Google's
// click id and the standard campaign tags are kept, each short and plain, so
// nothing a visitor typed can ride along.

export type AdParams = {
  gclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
};

const GCLID = /^[A-Za-z0-9_-]{8,200}$/;
const TAG = /^[\p{L}\p{N} ._+:/-]{1,100}$/u;

function tag(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return TAG.test(t) ? t.toLowerCase() : null;
}

/** The ad parameters of a landing, or null when it did not come from an ad. */
export function adParams(input: Record<string, unknown>): AdParams | null {
  const gclid = typeof input.gclid === "string" && GCLID.test(input.gclid) ? input.gclid : null;
  const out: AdParams = {
    gclid,
    utmSource: tag(input.utm_source),
    utmMedium: tag(input.utm_medium),
    utmCampaign: tag(input.utm_campaign),
    utmTerm: tag(input.utm_term),
  };
  // A paid visit has a click id or at least a source and a medium; a bare utm_term is noise.
  if (!out.gclid && !(out.utmSource && out.utmMedium)) return null;
  return out;
}

/** The query keys the page sends with its first view. */
export const AD_KEYS = ["gclid", "utm_source", "utm_medium", "utm_campaign", "utm_term"] as const;
