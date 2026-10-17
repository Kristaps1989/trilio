import type { Country } from "@/domain/delivery/holidays";

// Launch market is Latvia; Lithuania and Estonia follow. The market decides
// which stores are shown, which public holidays count and the default
// locale. One deployment serves one market (MARKET env); per-request
// markets come with the LT/EE launch.

export type Market = { country: Country; locale: "lv" | "lt" | "et"; domain: string };

export const MARKETS: Record<Country, Market> = {
  LV: { country: "LV", locale: "lv", domain: "trilio.lv" },
  LT: { country: "LT", locale: "lt", domain: "trilio.lt" },
  EE: { country: "EE", locale: "et", domain: "trilio.ee" },
};

export function currentMarket(env: Record<string, string | undefined> = process.env): Market {
  const c = (env.MARKET ?? "LV").toUpperCase();
  return MARKETS[(c === "LT" || c === "EE" ? c : "LV") as Country];
}
