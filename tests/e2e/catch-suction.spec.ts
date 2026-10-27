import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The "Bet:" line names the nearest fair step up (dearer, never a pick) and
// links to that product's card, never the same product twice; vacuums ask about carpets and offer
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

test("one honest catch per card: upward only, never a pick, linked to a card that lights up", async ({
  page,
}) => {
  await page.goto("/rezultati?sub=fridge");
  const cards = picks(page);
  await expect(cards.first()).toBeVisible();
  const pickIds = await cards.evaluateAll((els) => els.map((e) => e.id));
  const priceOf = async (id: string) =>
    Number(
      await page.locator(`article[id="${id}"] [data-price-cents]`).first().getAttribute("data-price-cents"),
    );
  const links = cards.locator("[data-catch-link]");
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  const hrefs: string[] = [];
  for (const card of await cards.all()) {
    // At most one "Bet:" on a card: the upgrade box says "Mīnusi:" instead.
    expect(((await card.textContent()) ?? "").match(/Bet: /g)?.length ?? 0).toBeLessThanOrEqual(1);
    const link = card.locator("[data-catch-link]");
    if ((await link.count()) === 0) continue;
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).toMatch(/^#p-/);
    hrefs.push(href);
    const target = href.slice(1);
    // Never another pick; never a cheaper product; always a card to land on.
    expect(pickIds).not.toContain(target);
    await expect(page.locator(`article[id="${target}"]`)).toHaveCount(1);
    expect(await priceOf(target)).toBeGreaterThanOrEqual(
      await priceOf((await card.getAttribute("id")) ?? ""),
    );
    await expect(link.locator("xpath=..")).toHaveText(
      /^Bet: .+\. .+ (ar|bez) .+ (maksā par [\d\s]+\s€ vairāk|maksā tikpat)\.$/,
    );
  }
  expect(new Set(hrefs).size).toBe(hrefs.length);

  // Following the link lands on that product's card, which flashes its ring (CSS :target).
  const first = links.first();
  const target = page.locator(`article[id="${(await first.getAttribute("href"))!.slice(1)}"]`);
  await first.click();
  await expect(page).toHaveURL(/#p-/);
  await expect(target).toBeInViewport();
  await expect(target).toHaveCSS("animation-name", "card-landed");
  await expect(target.locator("[data-price-cents]").first()).toBeVisible();
  // The products a catch names sit under "Soli augstāk".
  await expect(page.locator("[data-mentioned]")).toContainText("Soli augstāk");
  await expectNoAxeViolations(page);
});

test("the upgrade box says what you get and what you lose, in Latvian cases", async ({ page }) => {
  await page.goto("/rezultati?sub=fridge");
  const boxes = page.locator("[data-upgrade-gains]");
  await expect(boxes.first()).toBeVisible();
  const text = await boxes.allTextContents();
  expect(text.join(" ")).not.toMatch(/Bet: /);
  const downsides = text.filter((x) => x.includes("Mīnusi: "));
  expect(downsides.length).toBeGreaterThan(0);
  // Each item agrees with its attribute's noun ("par 97 L mazāks tilpums"), never a bare "−97 L tilpums".
  for (const line of downsides) expect(line).not.toMatch(/Mīnusi: .*(−|\+)\d/);
  expect(downsides.some((x) => /Mīnusi: .*par \d+ L mazāks tilpums/.test(x))).toBe(true);
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

test("choosing a cordless stick shows only sticks, also among the products a catch names", async ({
  page,
}) => {
  await page.goto("/izvelies/clean/vacuum");
  await choose(page, /^Vertikālais bezvadu/);
  for (let i = 0; i < 4 && (await h1(page).textContent()) !== "Cik vēlies tērēt?"; i++) await next(page);
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=vacuum/);
  const cards = page.locator("main article");
  await expect(cards.first()).toBeVisible();
  // Every card on the page (picks, extras, products a "Bet:" names) is a stick: its spec line says so.
  for (const card of await cards.all()) {
    if (await card.getByText(/ATJAUNOTA PRECE/).count()) continue;
    await expect(card).toContainText(/Vertikālais/);
    await expect(card).not.toContainText(/Robots/);
  }
});
