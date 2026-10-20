import type { EprelRecord } from "@/domain/catalog/eprel";

// EPREL public API (eprel.ec.europa.eu/api), checked 20 Oct 2026:
//   GET /product/gtin/{gtin}                         by EAN, no key needed
//   GET /products/{group}?modelIdentifier=…&_limit=… search, needs the key
//   GET /products/{group}/{registrationNumber}       one record, no key needed
// The key goes in the X-Api-Key header (EPREL_API_KEY). Records of suppliers
// that have not finished EPREL's verification are not returned (403
// UNVERIFIED_SUPPLIER); missing ones answer 404.

export const EPREL_API = "https://eprel.ec.europa.eu/api";

export type EprelClient = {
  /** Whether model search is available (needs the key). */
  canSearch: boolean;
  byGtin(gtin: string): Promise<EprelRecord[]>;
  searchModel(group: string, modelIdentifier: string): Promise<EprelRecord[]>;
};

export class EprelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createEprelClient(
  opts: { apiKey?: string | null; fetchImpl?: typeof fetch; base?: string } = {},
): EprelClient {
  const base = (opts.base ?? EPREL_API).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = opts.apiKey || null;

  async function get(path: string, withKey: boolean): Promise<unknown> {
    const res = await fetchImpl(`${base}${path}`, {
      headers: { accept: "application/json", ...(withKey && apiKey ? { "x-api-key": apiKey } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    // Not found, or a supplier EPREL has not verified: nothing usable, not an error.
    if (res.status === 404 || res.status === 403) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (res.status === 404 || body?.code === "UNVERIFIED_SUPPLIER") return null;
      throw new EprelError("EPREL refused the request (check EPREL_API_KEY)", 403);
    }
    if (!res.ok) throw new EprelError(`EPREL HTTP ${res.status}`, res.status);
    return res.json();
  }

  const records = (data: unknown): EprelRecord[] => {
    if (Array.isArray(data)) return data.filter((x): x is EprelRecord => !!x && typeof x === "object");
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      for (const list of [d.hits, d.content, d.products]) if (Array.isArray(list)) return records(list);
      if ("modelIdentifier" in d) return [d];
    }
    return [];
  };

  return {
    canSearch: !!apiKey,
    async byGtin(gtin) {
      if (!/^\d{8,14}$/.test(gtin)) return [];
      return records(await get(`/product/gtin/${gtin}`, false));
    },
    async searchModel(group, modelIdentifier) {
      if (!apiKey || !modelIdentifier.trim()) return [];
      const q = new URLSearchParams({ _page: "1", _limit: "10", modelIdentifier: modelIdentifier.trim() });
      return records(await get(`/products/${encodeURIComponent(group)}?${q.toString()}`, true));
    },
  };
}

export function eprelClientFromEnv(env: Record<string, string | undefined> = process.env): EprelClient {
  return createEprelClient({ apiKey: env.EPREL_API_KEY });
}
