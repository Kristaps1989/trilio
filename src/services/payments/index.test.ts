import { describe, expect, it } from "vitest";
import { appBaseUrl, paymentsEnabled, paymentsProvider } from "./index";
import { billingTexts, radarTexts } from "@/services/texts";

describe("paymentsProvider", () => {
  it("prefers Paysera when credentials exist", () => {
    const p = paymentsProvider({ PAYSERA_MAC_ID: "a", PAYSERA_MAC_KEY: "b", PAYSERA_BUSINESS_ID: "c" });
    expect(p?.name).toBe("paysera");
  });
  it("uses the mock only with the explicit insecure flag", () => {
    expect(paymentsProvider({ PAYMENTS_PROVIDER: "mock" })).toBeNull();
    expect(paymentsProvider({ PAYMENTS_PROVIDER: "mock", NODE_ENV: "development" })).toBeNull();
    expect(paymentsProvider({ PAYMENTS_PROVIDER: "mock", ALLOW_INSECURE_TEST_FEATURES: "1" })?.name).toBe(
      "mock",
    );
    expect(paymentsEnabled({})).toBe(false);
  });
  it("derives the base URL", () => {
    expect(appBaseUrl({})).toBe("http://localhost:3000");
    expect(appBaseUrl({ APP_URL: "https://trilio.lv/" })).toBe("https://trilio.lv");
  });
});

describe("job texts", () => {
  it("interpolate placeholders from the Latvian messages", () => {
    const r = radarTexts();
    expect(r.dropSubject({ name: "Bosch", price: "599 €" })).toBe("Cena kritusi: Bosch tagad 599 €");
    expect(r.similarBody({ name: "X", price: "1 €", shop: "S" })).toContain("1 €");
    const b = billingTexts();
    expect(b.receiptBody({ amount: "12 €", next: "1. maijs" })).toContain("1. maijs");
    expect(b.failedSubject).toBe("Cenu radara maksājums neizdevās");
    expect(b.expired).toContain("Abonements beidzies");
  });
});
