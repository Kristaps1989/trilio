import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The server runs with GA_MEASUREMENT_ID=G-TEST12345 (CI env). Google is never
// contacted: gtag.js is stubbed, so gtag() calls stay in window.dataLayer.

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(!process.env.GA_MEASUREMENT_ID, "GA_MEASUREMENT_ID is not set for the test server");

test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/**", (r) =>
    r.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route(/google-analytics\.com/, (r) => r.fulfill({ status: 204 }));
});

type GaEvent = { name: string; params: Record<string, string | undefined> };

function events(page: Page): Promise<GaEvent[]> {
  return page.evaluate(() =>
    (window.dataLayer ?? [])
      .map((entry) => Array.from(entry as ArrayLike<unknown>))
      .filter((a) => a[0] === "event")
      .map((a) => ({ name: a[1] as string, params: (a[2] ?? {}) as Record<string, string | undefined> })),
  );
}

const banner = (page: Page) => page.getByRole("region", { name: "Sīkdatnes statistikai" });

test("the consent banner offers equal choices, and declining loads nothing", async ({ page, context }) => {
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);

  await banner(page).getByRole("button", { name: "Neatļaut", exact: true }).click();
  await expect(banner(page)).toBeHidden();
  expect((await context.cookies()).find((c) => c.name === "trilio_consent")?.value).toBe("denied");
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
  expect(await page.evaluate(() => typeof window.gtag)).toBe("undefined");

  // The choice can be changed from any page footer.
  await page.getByRole("button", { name: "Sīkdatņu iestatījumi" }).click();
  await expect(banner(page)).toBeVisible();
});

test("after consent: page views carry the section, clicks and answers are tracked", async ({ page }) => {
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Atļaut", exact: true }).click();
  await expect(banner(page)).toBeHidden();
  await expect(page.locator('script[src*="googletagmanager.com/gtag/js?id=G-TEST12345"]')).toHaveCount(1);
  await expect.poll(async () => (await events(page)).some((e) => e.name === "page_view")).toBe(true);
  expect((await events(page)).find((e) => e.name === "page_view")?.params.section).toBe("home");

  await page.getByRole("link", { name: "Palīdzi izvēlēties" }).click();
  await expect(page).toHaveURL(/\/izvelies$/);
  await expect
    .poll(async () => (await events(page)).find((e) => e.name === "ui_click")?.params.label)
    .toBe("Palīdzi izvēlēties");
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "page_view").at(-1)?.params.section)
    .toBe("choose");

  await page.getByRole("link", { name: /Ledusskapji un saldētavas/ }).click();
  // Wait for the group page, or the next click can hit the group link again.
  await expect(page).toHaveURL(/\/izvelies\/cool$/);
  await page.getByRole("link", { name: /^Ledusskapji/ }).click();
  await expect(page).toHaveURL(/\/izvelies\/cool\/fridge/);
  await page.getByRole("radio").first().click();
  await expect
    .poll(async () => (await events(page)).find((e) => e.name === "answer_question")?.params)
    .toMatchObject({ section: "choose", subcategory: "fridge", question: expect.any(String) });
});

test("page views never include the query string", async ({ page }) => {
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Atļaut", exact: true }).click();
  await page.goto("/cits?text=mans%20numurs%2020000000");
  await expect
    .poll(async () => (await events(page)).filter((e) => e.name === "page_view").at(-1)?.params.page_location)
    .toMatch(/\/cits$/);
});

test("the CSP allows Google Analytics hosts when it is configured", async ({ page }) => {
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toContain("https://*.google-analytics.com");
});
