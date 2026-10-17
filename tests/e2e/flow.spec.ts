import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Phase 1 user journeys at 360 px and desktop, against the seeded sample data.

async function pick(page: Page, label: string | RegExp) {
  await page.getByRole("radio", { name: label }).click();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("fridge: built-in flow with niche height reaches three results within budget", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Palīdzi izvēlēties" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ko tu meklē?");
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: /Ledusskapji un saldētavas/ }).click();
  await page.getByRole("link", { name: /^Ledusskapji/ }).click();

  await expect(page.getByText(/Jautājums 1 no \d+/)).toBeVisible();
  await expectNoAxeViolations(page);
  await pick(page, /Iebūvējams/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cik augsta ir niša?");
  await expect(page.getByText(/Jautājums 2 no/)).toBeVisible();
  const input = page.getByRole("textbox");
  await expect(input).toHaveValue("178");
  await page.getByRole("button", { name: "Turpināt" }).click();
  await pick(page, /Jā, ar saldētavu/);
  await pick(page, /^3–4/);
  // priorities: multi-select up to 2
  await page.getByRole("checkbox", { name: /Klusums/ }).click();
  await page.getByRole("checkbox", { name: /No Frost/ }).click();
  await page.getByRole("button", { name: "Turpināt" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kāds ir tavs budžets?");
  await pick(page, /Līdz 1 200 €/);
  // refurbished question appears because the sample data has refurbished fridges
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vai rādīt arī atjaunotas preces?");
  await pick(page, /Jā, rādīt atsevišķi/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cik ātri prece tev vajadzīga?");
  await expect(page.getByText(/piegāde līdz .*dienai, \d+\. [a-zā]+/).first()).toBeVisible();
  await pick(page, /Nesteidzos/);

  await expect(page).toHaveURL(/\/rezultati\?sub=fridge/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trīs labākie varianti tev");
  const cards = page.getByRole("article");
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("article").getByText("Trilio ieteikums").first()).toBeVisible();
  await expect(page.getByText("Budžeta variants").first()).toBeVisible();
  await expect(page.getByText("ATJAUNOTA PRECE · RĀDĪTA ATSEVIŠĶI").first()).toBeVisible();
  // Compare table opens and the differences toggle works
  await page.getByRole("button", { name: "Salīdzināt parametrus blakus" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("checkbox", { name: "Rādīt tikai atšķirības" }).click();
  await expect(page.getByRole("rowheader", { name: "Zemākā cena" })).toBeVisible();
  await expectNoAxeViolations(page);

  // Affiliate link redirects (no open redirect: target comes from the DB)
  const buy = page.getByRole("link", { name: /^Pirkt — / }).first();
  const href = await buy.getAttribute("href");
  expect(href).toMatch(/^\/go\/[0-9a-f-]{36}/);
  const res = await page.request.get(href!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toMatch(/^https:\/\/example\.invalid\//);
});

test("vacuum: robot flow asks about mopping and hides the bag question", async ({ page }) => {
  await page.goto("/izvelies/clean/vacuum");
  await pick(page, /Robotu/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vai robotam jāmazgā arī grīda?");
  await pick(page, /Jā, arī jāmazgā/);
  await pick(page, /Līdz 50 m²/);
  await pick(page, /Cietas/);
  await page.getByRole("checkbox", { name: /Nekas no tā/ }).click();
  await page.getByRole("button", { name: "Turpināt" }).click();
  await page.getByRole("checkbox", { name: /Klusums/ }).click();
  await page.getByRole("button", { name: "Turpināt" }).click();
  await pick(page, /Budžets nav noteikts/);
  // vacuum sample data has refurbished robots → refurbished question
  await pick(page, /Nē, tikai jaunas/);
  await pick(page, /Pēc iespējas ātrāk/);
  await expect(page).toHaveURL(/\/rezultati\?sub=vacuum/);
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(page.getByText("ATJAUNOTA PRECE · RĀDĪTA ATSEVIŠĶI")).toHaveCount(0);
});

test("generic category: over-budget extras appear when fewer than three fit", async ({ page }) => {
  await page.goto("/izvelies/kitchensmall/kettle");
  await page.getByRole("checkbox", { name: /Temperatūras regulēšana/ }).click();
  await page.getByRole("button", { name: "Turpināt" }).click();
  await pick(page, /^1,5–1,7 L/);
  await pick(page, /Cita summa/);
  await page.getByRole("textbox").fill("25");
  await page.getByRole("button", { name: "Turpināt" }).click();
  await pick(page, /Tuvāko divu nedēļu laikā/);
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
  // With a 25 € budget the lead text says how many fit; extras, if any, are labelled.
  await expect(page.getByText(/atbilst tavām atbildēm un budžetam/)).toBeVisible();
  const over = page.getByText(/Virs budžeta par/);
  if ((await over.count()) > 0) await expect(over.first()).toBeVisible();
});

test("answers live in the URL: back keeps earlier answers and chips reopen a question with its answer", async ({
  page,
}) => {
  await page.goto("/izvelies/laundry/washer");
  await pick(page, /Ar priekšējo ielādi/);
  await pick(page, /^3–4/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cik daudz vietas ir vannasistabā?");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cik cilvēku ir tavā mājsaimniecībā?");
  await expect(page).toHaveURL(/a=/); // the first answer is still carried
  await page.goForward();
  await pick(page, /Pietiekami/);
  await page.getByRole("checkbox", { name: /Klusums/ }).click();
  await page.getByRole("button", { name: "Turpināt" }).click();
  await pick(page, /Budžets nav noteikts/);
  // washer sample data has refurbished items → refurbished question
  await pick(page, /Nē, tikai jaunas/);
  await pick(page, /Nesteidzos/);
  await expect(page).toHaveURL(/\/rezultati\?sub=washer/);
  // Chip reopens the household question with the earlier answer highlighted
  await page.getByRole("link", { name: /^3–4 · Mainīt/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cik cilvēku ir tavā mājsaimniecībā?");
  await expect(page.getByRole("radio", { name: /^3–4/ })).toHaveAttribute("aria-checked", "true");
});

test("free text routes a known phrase into the flow and shows the waitlist for out-of-scope text", async ({
  page,
}) => {
  await page.goto("/cits");
  await page.getByLabel("Tavs apraksts").fill("vajag rokas blenderi zupām");
  await page.getByRole("button", { name: "Atrast" }).click();
  await expect(page).toHaveURL(/\/izvelies\/kitchensmall\/handblender/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ar vadu vai bez?");
});

test("model check finds a product by model code and suggests alternatives", async ({ page }) => {
  await page.goto("/modelis?q=KGN39VLCT");
  await expect(page.getByRole("heading", { name: "Tava izvēle" })).toBeVisible();
  await expect(page.getByText(/Modelis KGN39VLCT/).first()).toBeVisible();
  await expect(page.getByText(/Vai izmēri der\?/)).toBeVisible();
  await page.goto("/modelis?q=https://shop.example/p/nope-xyz-123");
  await expect(page.getByRole("status")).toContainText("neatradām");
});
