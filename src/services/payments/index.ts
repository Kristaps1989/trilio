import { createMockProvider } from "./mock";
import { createPayseraProvider, payseraFromEnv } from "./paysera";
import { createPayseraCheckoutProvider, payseraCheckoutFromEnv } from "./paysera-checkout";
import type { PaymentProvider } from "./types";

// Which provider runs: Paysera Checkout when its OAuth client id and secret
// are set (prepaid periods), else Paysera Recurring Billing when its MAC
// credentials are set; otherwise the mock, only with
// ALLOW_INSECURE_TEST_FEATURES=1 (dev and CI). Without any, payments are
// off and the radar flow says so.

export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.APP_URL ?? env.NEXTAUTH_URL ?? env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function paymentsProvider(
  env: Record<string, string | undefined> = process.env,
): PaymentProvider | null {
  const checkout = payseraCheckoutFromEnv(env);
  if (checkout) return createPayseraCheckoutProvider(checkout);
  const paysera = payseraFromEnv(env);
  if (paysera) return createPayseraProvider(paysera);
  if (env.ALLOW_INSECURE_TEST_FEATURES === "1") {
    if (env.PAYMENTS_PROVIDER === "mock") return createMockProvider(appBaseUrl(env));
    if (env.PAYMENTS_PROVIDER === "mock-recurring")
      return createMockProvider(appBaseUrl(env), { recurring: true });
  }
  return null;
}

export function paymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return paymentsProvider(env) !== null;
}
