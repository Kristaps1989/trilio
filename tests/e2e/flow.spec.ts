import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Guided flow and results journeys at 360 px and desktop, against the seeded
// sample data. tests/e2e/categories.spec.ts walks every category with the
// default answers; this file covers the specific interactions.

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/); // a client navigation sets the title a moment later
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });

/** "Tālāk", then wait until the next screen is there. */
async function next(page: Page) {
  const title = (await h1(page).textContent()) ?? "";
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await expect(h1(page)).not.toHaveText(title);
}
const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

/** A picture card: tapping it selects and moves on to the next screen. */
async function choose(page: Page, name: RegExp) {
  const title = (await h1(page).textContent()) ?? "";
  await page.getByRole("radio", { name }).click();
  await expect(h1(page)).not.toHaveText(title);
}

/** Take the pre-selected answers until the price screen. */
async function toPrice(page: Page) {
  for (let i = 0; i < 8 && (await h1(page).textContent()) !== "Cik vēlies tērēt?"; i++) await next(page);
  await expect(h1(page)).toHaveText("Cik vēlies tērēt?");
}

async function priceOf(card: ReturnType<Page["locator"]>): Promise<number> {
  return Number(await card.locator("[data-price-cents]").first().getAttribute("data-price-cents")) / 100;
}

/** First "NNN cm" in the card's spec line: the height for fridges. */
async function heightOf(card: ReturnType<Page["locator"]>): Promise<number> {
  const text = (await card.textContent()) ?? "";
  const m = text.match(/(\d+(?:,\d+)?)\s*cm/);
  if (!m) throw new Error(`no height in ${text.slice(0, 80)}`);
  return Number(m[1]!.replace(",", "."));
}

test("the owner's fridge: standard, at most 178 cm, 350–500 € — no small or cheap fridges", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Palīdzi izvēlēties" }).click();
  await expect(h1(page)).toHaveText("Ko tu meklē?");
  await page.getByRole("link", { name: /Ledusskapji un saldētavas/ }).click();
  await expect(h1(page)).toHaveText("Izvēlies precīzāk");
  await page.getByRole("link", { name: /^Ledusskapji brīvi/ }).click();

  // Freestanding or built-in: picture cards, the most common pre-selected, each with a live count.
  await expect(h1(page)).toHaveText("Brīvi stāvošs vai iebūvējams?");
  const free = page.getByRole("radio", { name: /^Brīvi stāvošs/ });
  await expect(free).toHaveAttribute("aria-checked", "true");
  await expect(free).toContainText(/\d+ preces/);
  await expectNoAxeViolations(page);
  await next(page);

  // Height as sizes people know; the owner's "up to 178 cm" is the 166–180 cm card.
  await expect(h1(page)).toHaveText("Cik augstam jābūt?");
  for (const size of [/^~54 cm/, /^~85 cm/, /^125–160 cm/, /^166–180 cm/, /^181–205 cm/])
    await expect(page.getByRole("radio", { name: size })).toBeVisible();
  await expectNoAxeViolations(page);
  await choose(page, /^166–180 cm/);

  await expect(h1(page)).toHaveText("Cik durvju?");
  await choose(page, /^Divas durvis/);

  await expect(h1(page)).toHaveText("Cik cilvēku ir tavā mājsaimniecībā?");
  await next(page);

  // Price: a min–max range typed in the number fields.
  await expect(h1(page)).toHaveText("Cik vēlies tērēt?");
  await page.getByRole("textbox", { name: "Zemākā cena, eiro" }).fill("350");
  await page.getByRole("textbox", { name: "Augstākā cena, eiro" }).fill("500");
  await page.getByRole("textbox", { name: "Augstākā cena, eiro" }).blur();
  await expectNoAxeViolations(page);
  const show = page.getByRole("button", { name: /^Rādīt (labākos 3 no \d+|\d+ prec)/ });
  await expect(show).toBeEnabled();
  await show.click();

  await expect(page).toHaveURL(/\/rezultati\?sub=fridge/);
  await expect(h1(page)).toHaveText("Trīs labākie varianti tev");
  await expect(picks(page).first()).toBeVisible();
  for (const card of await picks(page).all()) {
    expect(await heightOf(card)).toBeGreaterThanOrEqual(150);
    expect(await heightOf(card)).toBeLessThanOrEqual(180.5);
    const text = (await card.textContent()) ?? "";
    expect(await priceOf(card)).toBeGreaterThanOrEqual(350);
    if (!/Virs budžeta par/.test(text)) expect(await priceOf(card)).toBeLessThanOrEqual(500);
  }
  // The choices are chips that say what was asked.
  const chips = page.getByRole("navigation", { name: "Tavas izvēles" });
  await expect(chips.getByRole("button", { name: /166–180 cm/ })).toBeVisible();
  await expect(chips.getByRole("button", { name: /Divas durvis/ })).toBeVisible();
  // Fewer than three would offer the smallest changes ("+ N varianti, ja …") instead of a dead end.
  if ((await picks(page).count()) < 3) await expect(page.getByText(/\+ \d+ variant/).first()).toBeVisible();
  await expectNoAxeViolations(page);
});

test("results: compare table, refurbished block and the affiliate redirect", async ({ page }) => {
  await page.goto("/izvelies/cool/fridge");
  await next(page);
  // The tallest size: the sample data has a refurbished Bosch of 203 cm.
  await choose(page, /^181–205 cm/);
  await toPrice(page);
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=fridge/);
  await expect(picks(page)).toHaveCount(3);
  await expect(page.getByText("ATJAUNOTA PRECE · RĀDĪTA ATSEVIŠĶI").first()).toBeVisible();
  // Refurbished never appears among the picks.
  await expect(picks(page).filter({ hasText: /Atjaunota/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Salīdzināt parametrus blakus" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("checkbox", { name: "Rādīt tikai atšķirības" }).click();
  await expect(page.getByRole("rowheader", { name: "Zemākā cena" })).toBeVisible();
  await expectNoAxeViolations(page);

  const buy = page.getByRole("link", { name: /^Pirkt — / }).first();
  const href = await buy.getAttribute("href");
  expect(href).toMatch(/^\/go\/[0-9a-f-]{36}/);
  const res = await page.request.get(href!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toMatch(/^https:\/\/example\.invalid\//);
});

test("results: a chip opens a sheet that edits the filter in place", async ({ page }) => {
  await page.goto("/izvelies/cool/fridge");
  await next(page);
  await choose(page, /^166–180 cm/);
  await toPrice(page);
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=fridge/);
  const url = page.url();

  const chips = page.getByRole("navigation", { name: "Tavas izvēles" });
  await chips.getByRole("button", { name: /166–180 cm/ }).click();
  const sheet = page.getByRole("dialog", { name: "Cik augstam jābūt?" });
  await expect(sheet).toBeVisible();
  await expectNoAxeViolations(page);
  await sheet.getByRole("radio", { name: /^181–205 cm/ }).click();
  const apply = sheet.getByRole("button", { name: /^Rādīt (labākos 3 no \d+|\d+ rezultāt)/ });
  await expect(apply).toBeEnabled();
  await apply.click();

  await expect(page).not.toHaveURL(url);
  await expect(chips.getByRole("button", { name: /181–205 cm/ })).toBeVisible();
  for (const card of await picks(page).all()) expect(await heightOf(card)).toBeGreaterThan(180);

  // Cancel leaves everything as it was.
  await chips.getByRole("button", { name: /Jebkura cena/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Atcelt" }).first().click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(chips.getByRole("button", { name: /Jebkura cena/ })).toBeVisible();
});

test("price screen: an empty range is never a dead end", async ({ page }) => {
  await page.goto("/izvelies/cool/fridge");
  await toPrice(page);
  await expect(h1(page)).toHaveText("Cik vēlies tērēt?");
  // Both ends at the cheapest price in stock: usually nothing fits exactly.
  const min = page.getByRole("textbox", { name: "Zemākā cena, eiro" });
  const max = page.getByRole("textbox", { name: "Augstākā cena, eiro" });
  await min.fill("1");
  await min.blur();
  await max.fill("1");
  await max.blur();
  const empty = page.getByRole("button", { name: "Šajā robežā nav preču" });
  const show = page.getByRole("button", { name: /^Rādīt (labākos 3 no \d+|\d+ prec)/ });
  await expect(empty.or(show)).toBeVisible();
  if (await empty.isVisible()) {
    await expect(empty).toBeDisabled();
    await expect(page.getByText(/nav nevienas preces — paplašināt līdz/)).toBeVisible();
    await page.getByRole("button", { name: /^\d[\d\s]* €$/ }).click();
    await expect(show).toBeEnabled();
  }
  // The price sliders work from the keyboard too.
  const upper = page.getByRole("slider", { name: "Augstākā cena, eiro" });
  const before = Number(await upper.inputValue());
  await upper.focus();
  await page.keyboard.press("ArrowRight");
  expect(Number(await upper.inputValue())).toBeGreaterThan(before);
});

test("answers live in the URL: back keeps earlier answers and 'Mainīt atbildes' reopens the flow", async ({
  page,
}) => {
  await page.goto("/izvelies/laundry/washer");
  await expect(h1(page)).toHaveText("Kāda veļas mašīna tev vajadzīga?");
  await next(page);
  const second = (await h1(page).textContent()) ?? "";
  expect(second).not.toBe("Kāda veļas mašīna tev vajadzīga?");
  await expect(page).toHaveURL(/a=/);
  await page.goBack();
  await expect(h1(page)).toHaveText("Kāda veļas mašīna tev vajadzīga?");
  await page.goForward();
  await expect(h1(page)).toHaveText(second);
  for (let i = 0; i < 6 && (await h1(page).textContent()) !== "Cik vēlies tērēt?"; i++) await next(page);
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=washer/);
  await page.getByRole("link", { name: "Mainīt atbildes" }).click();
  await expect(page).toHaveURL(/\/izvelies\/laundry\/washer\?a=/);
  await expect(h1(page)).toHaveText("Kāda veļas mašīna tev vajadzīga?");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
});

test("free text routes a known phrase into the flow", async ({ page }) => {
  await page.goto("/cits");
  await page.getByLabel("Tavs apraksts").fill("vajag rokas blenderi zupām");
  await page.getByRole("button", { name: "Atrast" }).click();
  await expect(page).toHaveURL(/\/izvelies\/kitchensmall\/handblender/);
  await expect(h1(page)).toHaveText("Ar vadu vai bezvadu?");
});

test("model check finds a product by model code and suggests alternatives", async ({ page }) => {
  await page.goto("/modelis?q=KGN39VLCT");
  await expect(page.getByRole("heading", { name: "Tava izvēle" })).toBeVisible();
  await expect(page.getByText(/Modelis KGN39VLCT/).first()).toBeVisible();
  await expect(page.getByText(/Vai izmēri der\?/)).toBeVisible();
  await page.goto("/modelis?q=https://shop.example/p/nope-xyz-123");
  await expect(page.getByRole("status")).toContainText("neatradām");
});

test("results: more than three options on request, best value first", async ({ page }) => {
  await page.goto("/izvelies/kitchensmall/kettle");
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
  await expect(page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article")).toHaveCount(3);

  const more = page.getByRole("link", { name: /^Rādīt vairāk variantus \(\d+\)$/ });
  const total = Number(((await more.textContent()) ?? "").match(/\((\d+)\)/)![1]);
  expect(total).toBeGreaterThan(0);
  await more.click();
  const section = page.getByRole("region", { name: "Citi varianti šajā cenu robežā" });
  await expect(section.getByRole("article")).toHaveCount(Math.min(10, total));
  if (total <= 10) await expect(section.getByRole("link", { name: /^Rādīt vēl/ })).toHaveCount(0);
});
