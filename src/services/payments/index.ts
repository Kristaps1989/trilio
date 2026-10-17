import { createMockProvider } from "./mock";
import { createPayseraProvider, payseraFromEnv } from "./paysera";
import type { PaymentProvider } from "./types";

// Which provider runs: Paysera when its credentials are set; otherwise the
// mock, only with ALLOW_INSECURE_TEST_FEATURES=1 (dev and CI). Without
// either, payments are off and the radar flow says so.

export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.APP_URL ?? env.NEXTAUTH_URL ?? env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function paymentsProvider(
  env: Record<string, string | undefined> = process.env,
): PaymentProvider | null {
  const paysera = payseraFromEnv(env);
  if (paysera) return createPayseraProvider(paysera);
  if (env.PAYMENTS_PROVIDER === "mock" && env.ALLOW_INSECURE_TEST_FEATURES === "1")
    return createMockProvider(appBaseUrl(env));
  return null;
}

export function paymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return paymentsProvider(env) !== null;
}
