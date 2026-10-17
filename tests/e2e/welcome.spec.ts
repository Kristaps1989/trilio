import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("welcome screen renders in Latvian with both entry points", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pastāsti, kas tev vajadzīgs");
  await expect(page.getByRole("link", { name: "Palīdzi izvēlēties" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Es jau zinu modeli" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "lv");
});

test("no horizontal scroll and touch targets ≥ 44 px", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  for (const link of await page.getByRole("link").all()) {
    const box = await link.boundingBox();
    expect(box, "link has a box").not.toBeNull();
    expect(box!.height, "touch target height").toBeGreaterThanOrEqual(44);
  }
});

test("security headers are present", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("no accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});
