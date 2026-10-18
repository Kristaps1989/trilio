import { defineConfig, devices } from "@playwright/test";

// Read-only smoke suite (docs/DESIGN_FIX_PLAN.md §5) for a running site:
// CI runs it against a freshly migrated, empty database; the "Smoke"
// workflow runs it against https://trilio.lv after deploys and hourly.
const baseURL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  retries: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    storageState: {
      cookies: [
        {
          name: "trilio_consent",
          value: "denied",
          domain: new URL(baseURL).hostname,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: baseURL.startsWith("https"),
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
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
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
