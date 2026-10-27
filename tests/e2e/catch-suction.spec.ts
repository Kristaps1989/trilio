import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The "Bet:" line names the nearest fair step up and links to that product's
// card, never the same product twice; vacuums ask about carpets and offer
// "Jaudīga sūkšana", judged by pascals or air watts, never by input watts.

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

async function choose(page: Page, name: RegExp) {
  const title = (await h1(page).textContent()) ?? "";
  await page.getByRole("radio", { name }).click();
  await expect(h1(page)).not.toHaveText(title);
}

async function next(page: Page) {
  const title = (await h1(page).textContent()) ?? "";
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await expect(h1(page)).not.toHaveText(title);
}

test("the catch names a different product on each card and links to its card", async ({ page }) => {
  await page.goto("/rezultati?sub=fridge");
  await expect(picks(page).first()).toBeVisible();
  const links = picks(page).locator("[data-catch-link]");
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  const hrefs: string[] = [];
  for (const link of await links.all()) {
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).toMatch(/^#p-/);
    hrefs.push(href);
    // Every named product has a card on the page to land on.
    await expect(page.locator(`article[id="${href.slice(1)}"]`)).toHaveCount(1);
    await expect(link.locator("xpath=..")).toHaveText(
      /^Bet: .+ — .+, (maksā \+[\d\s]+(,\d+)?\s€|ir par [\d\s]+(,\d+)?\s€ lētāks|maksā tikpat)\.$/,
    );
  }
  expect(new Set(hrefs).size).toBe(hrefs.length);

  // Following the link brings that product's card, with its price and buy button, into view.
  const first = links.first();
  const target = page.locator(`article[id="${(await first.getAttribute("href"))!.slice(1)}"]`);
  await first.click();
  await expect(page).toHaveURL(/#p-/);
  await expect(target).toBeInViewport();
  await expect(target.locator("[data-price-cents]").first()).toBeVisible();
  await expectNoAxeViolations(page);
});

test("a robot vacuum: the carpet question and strong suction in pascals", async ({ page }) => {
  await page.goto("/izvelies/clean/vacuum");
  await expect(h1(page)).toHaveText("Kādu putekļsūcēju meklē?");
  await choose(page, /^Robots(?! ar)/);
  // Area and pets come first (area is skipped when every robot passes it); then carpets.
  for (let i = 0; i < 3 && (await h1(page).textContent()) !== "Vai mājā ir paklāji?"; i++) await next(page);
  await expect(h1(page)).toHaveText("Vai mājā ir paklāji?");
  await expectNoAxeViolations(page);
  await choose(page, /^Jā/);
  await expect(h1(page)).toHaveText("Cik vēlies tērēt?");
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=vacuum/);

  // The strongest robot (12 000 Pa) earns the carpet reason; its suction shows in pascals.
  const strong = picks(page).filter({ hasText: "Jaudīga sūkšana paklājiem" });
  await expect(strong.first()).toBeVisible();
  await expect(strong.first()).toContainText(/12\s000 Pa/);
  // "Jaudīga sūkšana" is one of the priorities one tap away.
  await expect(
    page
      .getByRole("navigation", { name: "Kas tev svarīgāk?" })
      .getByRole("link", { name: "Jaudīga sūkšana" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("a cordless stick is judged by air watts; a corded vacuum is never asked about carpets", async ({
  page,
}) => {
  await page.goto("/izvelies/clean/vacuum");
  await choose(page, /^Vertikālais bezvadu/);
  await next(page);
  await choose(page, /^Jā/);
  await expect(h1(page)).toHaveText("Vai mājā ir paklāji?");
  await choose(page, /^Jā/);
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  const strong = picks(page).filter({ hasText: "Jaudīga sūkšana paklājiem" });
  await expect(strong.first()).toBeVisible();
  await expect(page.getByText(/185 AW|22\s000 Pa/).first()).toBeVisible();

  await page.goto("/izvelies/clean/vacuum");
  await choose(page, /^Ar vadu/);
  await expect(h1(page)).toHaveText("Vai mājā ir mājdzīvnieki?");
  await choose(page, /^Nē/);
  // No carpet question: input watts say nothing about suction, so it would only guess.
  await expect(h1(page)).toHaveText("Cik vēlies tērēt?");
});
