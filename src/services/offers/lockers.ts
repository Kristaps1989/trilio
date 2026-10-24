// Parcel lockers for small appliances (docs/ADMIN_AND_OFFERS_PLAN.md §11.4).
// Omniva publishes every location as public JSON; Latvian parcel machines
// are TYPE "0" with A0_NAME "LV". The list is cached for a day. If it cannot
// be fetched the form asks for the locker in words instead, so checkout
// never breaks because of a carrier's file.

export type Locker = { id: string; name: string; city: string; address: string };

const DEFAULT_URL = "https://www.omniva.ee/locations.json";
const TTL_MS = 24 * 3600 * 1000;

type Raw = Record<string, string | undefined>;

export function parseOmnivaLocations(data: unknown): Locker[] {
  if (!Array.isArray(data)) return [];
  const out: Locker[] = [];
  for (const row of data as Raw[]) {
    if (row.A0_NAME !== "LV" || row.TYPE !== "0" || !row.ZIP || !row.NAME) continue;
    const city = row.A3_NAME || row.A2_NAME || row.A1_NAME || "";
    const address = [row.A5_NAME, row.A7_NAME].filter(Boolean).join(" ");
    out.push({ id: `omniva:${row.ZIP}`, name: row.NAME, city, address });
  }
  return out.sort((a, b) => a.city.localeCompare(b.city, "lv") || a.name.localeCompare(b.name, "lv"));
}

let cache: { at: number; lockers: Locker[] } | null = null;

export async function omnivaLockers(
  opts: { url?: string; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<Locker[]> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < TTL_MS && cache.lockers.length) return cache.lockers;
  const url = opts.url ?? process.env.OMNIVA_LOCATIONS_URL ?? DEFAULT_URL;
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return cache?.lockers ?? [];
    const lockers = parseOmnivaLocations(await res.json());
    if (lockers.length) cache = { at: now, lockers };
    return lockers.length ? lockers : (cache?.lockers ?? []);
  } catch {
    return cache?.lockers ?? [];
  }
}

export function resetLockerCache(): void {
  cache = null;
}

export function lockerLabel(l: Locker): string {
  return `${l.name} — ${l.address ? `${l.address}, ` : ""}${l.city}`;
}
