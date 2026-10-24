import { defineConfig, devices } from "@playwright/test";

// Every flow runs at 360 px first (CLAUDE.md: the main flow must work at 360 px).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    // Analytics consent already declined, so the consent banner never covers other tests
    // (tests/e2e/analytics.spec.ts starts without it).
    storageState: {
      cookies: [
        {
          name: "trilio_consent",
          value: "denied",
          domain: new URL(process.env.BASE_URL ?? "http://localhost:3000").hostname,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
    // Lets a sandbox with a pre-installed Chromium run the suite; unset in CI.
    launchOptions: process.env.PW_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_EXECUTABLE_PATH }
      : undefined,
  },
  projects: [
    {
      name: "mobile-360",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      // A local stand-in for the Claude Messages API (tests/e2e/mock-anthropic.mjs).
      command: "node tests/e2e/mock-anthropic.mjs",
      url: "http://127.0.0.1:4010/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Omniva's public parcel-locker list (tests/e2e/mock-carriers.mjs).
      command: "node tests/e2e/mock-carriers.mjs",
      url: "http://127.0.0.1:4011/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run build && npm run start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // Free-text routing talks to the mock, so the prompt-caching wiring is tested end to end.
      env: {
        ...(process.env as Record<string, string>),
        FEATURE_FREE_TEXT_LLM: "1",
        ANTHROPIC_API_KEY: "e2e-mock-key",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4010",
        // The admin section and personal offers (tests/e2e/admin.spec.ts, offers.spec.ts).
        ADMIN_EMAILS: "e2e-admin@example.invalid",
        OFFERS_SENDER_NAME: "Kristaps",
        OMNIVA_LOCATIONS_URL: "http://127.0.0.1:4011/locations.json",
        // Paid traffic against a fake account (tests/e2e/ads.spec.ts).
        FEATURE_ADS: "1",
        ADS_PROVIDER: "mock",
      },
    },
  ],
});
