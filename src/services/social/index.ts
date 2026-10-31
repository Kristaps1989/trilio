import { metaConfigFromEnv, metaProvider } from "./meta";
import { mockSocialProvider } from "./mock";
import type { SocialProvider } from "./provider";

/** Posting is on with FEATURE_SOCIAL=1 and either Meta credentials or SOCIAL_PROVIDER=mock. */
export function socialProvider(env: Record<string, string | undefined> = process.env): SocialProvider | null {
  if (env.FEATURE_SOCIAL !== "1") return null;
  if (env.SOCIAL_PROVIDER === "mock") return mockSocialProvider();
  const cfg = metaConfigFromEnv(env);
  return cfg ? metaProvider(cfg) : null;
}

export type { Network, SocialProvider } from "./provider";
