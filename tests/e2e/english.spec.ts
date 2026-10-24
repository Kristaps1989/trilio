import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// English under /en (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md Part A): the same
// pages and path words, English text and formats, html lang, hreflang, the
// header switch and its cookie, and the e-mail language of a new account.

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("the English home page: lang, hreflang, canonical and the switch to Latvian", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(h1(page)).toHaveText("Tell us what you need. We'll find the three best options.");
  await expect(page.getByRole("link", { name: "Help me choose" })).toHaveAttribute("href", "/en/izvelies");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en$/);
  await expect(page.locator('link[rel="alternate"][hreflang="lv"]')).toHaveAttribute(
    "href",
    /^https?:\/\/[^/]+\/?$/,
  );
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", /\/en$/);
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "en_GB");
  const toLv = page.getByRole("link", { name: "Šī lapa latviešu valodā" });
  await expect(toLv).toHaveAttribute("lang", "lv");
  await expect(toLv).toHaveText("LV");
  await expectNoAxeViolations(page);
});

test("the switch keeps the page and query, and the home page remembers the choice", async ({
  page,
  context,
}) => {
  await page.goto("/izvelies");
  await expect(page.locator("html")).toHaveAttribute("lang", "lv");
  await page.getByRole("link", { name: "This page in English" }).click();
  await expect(page).toHaveURL(/\/en\/izvelies$/);
  await expect(h1(page)).toHaveText("What are you looking for?");
  expect((await context.cookies()).find((c) => c.name === "trilio_lang")?.value).toBe("en");

  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);

  await page.goto("/en/rezultati?sub=kettle");
  await page.getByRole("link", { name: "Šī lapa latviešu valodā" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "lv");
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "lv");
});

test("/lv/… is not an address: it redirects to the unprefixed page; /en/admin does not exist", async ({
  request,
}) => {
  const res = await request.get("/lv/izvelies", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers().location).toMatch(/\/izvelies$/);
  expect((await request.get("/en/admin")).status()).toBe(404);
  expect((await request.get("/en/nav-tadas-lapas")).status()).toBe(404);
});

test("the English flow: questions from the English catalog, arrow keys, € in front, Latvian names marked", async ({
  page,
}) => {
  await page.goto("/en/izvelies");
  await page.getByRole("link", { name: /Fridges and freezers/ }).click();
  await expect(h1(page)).toHaveText("Be more specific");
  await page.getByRole("link", { name: /^Fridges/ }).click();
  await expect(page).toHaveURL(/\/en\/izvelies\/cool\/fridge/);
  await expect(h1(page)).toHaveText("Freestanding or built-in?");

  // One tab stop for the group; the arrow keys move between the options without choosing.
  const free = page.getByRole("radio", { name: /^Freestanding/ });
  const built = page.getByRole("radio", { name: /^Built-in/ });
  await expect(free).toHaveAttribute("aria-checked", "true");
  await expect(free).toHaveAttribute("tabindex", "0");
  await expect(built).toHaveAttribute("tabindex", "-1");
  await free.focus();
  await page.keyboard.press("ArrowRight");
  await expect(built).toBeFocused();
  await expect(free).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(free).toBeFocused();
  await expect(free).toContainText(/\d+ products?/);
  await expectNoAxeViolations(page);

  for (let i = 0; i < 8 && (await h1(page).textContent()) !== "How much do you want to spend?"; i++) {
    const title = (await h1(page).textContent()) ?? "";
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(h1(page)).not.toHaveText(title);
  }
  await expect(h1(page)).toHaveText("How much do you want to spend?");
  await expect(page.getByText(/€\d/).first()).toBeVisible();
  await page
    .getByRole("button", { name: /^Show|^See/ })
    .first()
    .click();

  await expect(page).toHaveURL(/\/en\/rezultati\?sub=fridge/);
  const picks = page.getByRole("region", { name: "Recommended options" }).getByRole("article");
  await expect(picks.first()).toBeVisible();
  await expect(picks.first().locator("h3")).toHaveAttribute("lang", "lv");
  await expect(picks.first()).toContainText(/€\d/);
  await expect(picks.first()).not.toContainText(/\d €/);
  await expect(page.getByRole("heading", { level: 2, name: "Recommended options" })).toBeAttached();
  await expectNoAxeViolations(page);
});

test("English category landing page and legal page with the binding Latvian text linked", async ({
  page,
}) => {
  await page.goto("/en/kategorija/fridge");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(h1(page)).toHaveText("The best fridges");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/kategorija\/fridge$/);
  await expect(page.locator('link[rel="alternate"][hreflang="lv"]')).toHaveAttribute(
    "href",
    /[^n]\/kategorija\/fridge$/,
  );
  await expect(page.getByRole("link", { name: /Start/ }).first()).toHaveAttribute(
    "href",
    "/en/izvelies/cool/fridge",
  );
  await expectNoAxeViolations(page);

  await page.goto("/en/privatums");
  await expect(h1(page)).toHaveText("Privacy policy");
  await expect(page.getByText("The Latvian version is binding.")).toBeVisible();
  const lv = page.getByRole("link", { name: "Latvian version" });
  await expect(lv).toHaveAttribute("href", "/privatums");
  await expect(page.getByRole("heading", { name: "In short" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto("/privatums");
  await expect(page.getByRole("heading", { name: "Īsumā" })).toBeVisible();
  await expect(page.getByText("The Latvian version is binding.")).toHaveCount(0);
});

test("a new account made on English pages writes in English; the account page changes it", async ({
  page,
}) => {
  const email = `e2e-en-${Date.now()}@example.invalid`;
  await page.goto("/en/ienakt?callbackUrl=/konts");
  await expect(h1(page)).toHaveText("Sign in");
  await page.getByLabel("E-mail").last().fill(email);
  await page.getByRole("button", { name: "Sign in without a password" }).click();
  await expect(page).toHaveURL(/\/en\/konts$/);
  const language = page.getByRole("group", { name: "Our e-mails to you are in this language." });
  await expect(language.getByRole("radio", { name: "English" })).toBeChecked();
  await language.getByRole("radio", { name: "Latviešu" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(language.getByRole("radio", { name: "Latviešu" })).toBeChecked();
  await expectNoAxeViolations(page);
});

test("the sitemap lists both languages with hreflang alternates", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toMatch(/<loc>[^<]*\/en\/kategorija\/fridge<\/loc>/);
  expect(xml).toMatch(/<loc>[^<]*[^n]\/kategorija\/fridge<\/loc>/);
  expect(xml).toContain('hreflang="en"');
  expect(xml).toContain('hreflang="x-default"');
});
