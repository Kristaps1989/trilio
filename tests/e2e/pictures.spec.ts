import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Product photos and the EPREL energy badge (docs/PICTURES_AND_LLM_PLAN.md).
// The sample kettles carry local photos (public/sample); the Bosch KIN86VFE0
// sample is a real EPREL product (registration 380048); KGN39VLCT has neither.

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function kettleResults(page: Page) {
  await page.goto("/izvelies/kitchensmall/kettle");
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
}

const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

/** Waits until the image has decoded, then returns its natural width (0 = broken). */
async function loadedWidth(img: ReturnType<Page["locator"]>): Promise<number> {
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete)).toBe(true);
  return img.evaluate((el: HTMLImageElement) => el.naturalWidth);
}

test("result cards show each product's photo, named by the product, through our optimiser", async ({
  page,
}) => {
  await kettleResults(page);
  const cards = picks(page);
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    const name = (await card.getAttribute("aria-label")) ?? "";
    const img = card.getByRole("img", { name, exact: true });
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", /\/_next\/image\?url=%2Fsample%2Fkettle-/);
    expect(await loadedWidth(img)).toBeGreaterThan(0);
  }
  await expectNoAxeViolations(page);
});

test("a photo that fails to load is replaced by the category drawing", async ({ page }) => {
  await page.route("**/_next/image**", (route) => route.fulfill({ status: 404, body: "" }));
  await kettleResults(page);
  const first = picks(page).first();
  await expect(first.locator('[data-photo="no"] svg')).toBeVisible();
  await expect(first.getByRole("img")).toHaveCount(0);
});

test("model page: EPREL badge with the official label and sheet; no photo → drawing", async ({ page }) => {
  await page.goto("/modelis?q=KIN86VFE0");
  const card = page.getByRole("article", { name: /KIN86VFE0|Bosch iebūvējams ledusskapis/ }).first();
  await expect(card).toBeVisible();
  expect(await loadedWidth(card.getByRole("img", { name: /Bosch iebūvējams ledusskapis/ }))).toBeGreaterThan(
    0,
  );
  await expect(card.getByRole("img", { name: /^Energoklase E/ })).toHaveText("E");
  await expect(card.getByRole("link", { name: "Energomarķējums" })).toHaveAttribute(
    "href",
    "https://eprel.ec.europa.eu/api/products/refrigeratingappliances2019/380048/labels?format=PNG",
  );
  await expect(card.getByRole("link", { name: "Informācijas lapa" })).toHaveAttribute(
    "href",
    "https://eprel.ec.europa.eu/api/products/refrigeratingappliances2019/380048/fiches?language=LV",
  );
  await expectNoAxeViolations(page);

  // A product without an EPREL match or a photo: no badge, the fridge drawing instead.
  await page.goto("/modelis?q=KGN39VLCT");
  const plain = page.getByRole("region", { name: "Tava izvēle" }).getByRole("article").first();
  await expect(plain).toBeVisible();
  await expect(plain.getByRole("link", { name: "Energomarķējums" })).toHaveCount(0);
  await expect(plain.locator('[data-photo="no"] svg')).toBeVisible();
});

test("wishlist shows the saved product's photo", async ({ page }) => {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent("/velmju-saraksts")}`);
  await page.getByLabel("E-pasts").last().fill(`e2e-photo-${Date.now()}@example.invalid`);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));

  await kettleResults(page);
  const first = picks(page).first();
  const name = (await first.getAttribute("aria-label")) ?? "";
  await first.getByRole("button", { name: "Paziņot, kad cena samazināsies", exact: true }).click();
  // The first tap asks the one yes (every category covers Trilio's offers).
  await first.locator("[data-notify-panel]").getByRole("button", { name: "Paziņot man" }).click();
  // Enabled again once the save has reached the server (the heart fills at once).
  await expect(
    first.getByRole("button", { name: "Paziņosim, kad cena samazināsies", exact: true }),
  ).toBeEnabled();

  await page.goto("/velmju-saraksts");
  const saved = page.getByRole("region", { name: "Saglabātās preces" }).getByRole("article", { name });
  expect(await loadedWidth(saved.getByRole("img", { name, exact: true }))).toBeGreaterThan(0);
  await expectNoAxeViolations(page);

  await page.goto("/konts");
  await page.getByRole("button", { name: "Dzēst kontu" }).click();
  await page.getByRole("button", { name: "Jā, dzēst" }).click();
  await page.waitForURL(/\/\?deleted=1/);
});
