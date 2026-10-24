import { googleAdsConfigFromEnv, googleAdsProvider } from "./google";
import { mockProvider } from "./mock";
import type { AdsProvider } from "./provider";

/** Ads are on with FEATURE_ADS=1 and either Google credentials or ADS_PROVIDER=mock. */
export function adsProvider(env: Record<string, string | undefined> = process.env): AdsProvider | null {
  if (env.FEATURE_ADS !== "1") return null;
  if (env.ADS_PROVIDER === "mock") return mockProvider();
  const cfg = googleAdsConfigFromEnv(env);
  return cfg ? googleAdsProvider(cfg) : null;
}

export type { AdsProvider } from "./provider";
