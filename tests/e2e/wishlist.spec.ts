import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The wishlist (owner, 20 Oct 2026; replaced the radar): a heart saves a
// product or a whole search, the list shows today's best offer and the price
// history, and saving means "e-mail me when it is cheaper" — free, on by
// default, off with one tap (docs/TRUST_POLISH_PLAN.md §1). Runs against the
// seeded sample data with the dev login.

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function signInOnPage(page: Page, email: string) {
  await page.getByLabel("E-pasts").last().fill(email);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));
}

async function devLogin(page: Page, email: string, callbackUrl = "/velmju-saraksts") {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await signInOnPage(page, email);
}

async function kettleResults(page: Page) {
  await page.goto("/izvelies/kitchensmall/kettle");
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
}

const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

async function deleteAccount(page: Page) {
  await page.goto("/konts");
  await page.getByRole("button", { name: "Dzēst kontu" }).click();
  await page.getByRole("button", { name: "Jā, dzēst" }).click();
  await page.waitForURL(/\/\?deleted=1/);
}

test.describe.configure({ mode: "serial" });

test("wishlist: signed out shows sign-in only; old radar links land on it; endpoints need auth", async ({
  page,
  request,
}) => {
  await page.goto("/velmju-saraksts");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tavs vēlmju saraksts");
  await expect(page.getByRole("link", { name: "Ienākt" }).last()).toBeVisible();
  await expectNoAxeViolations(page);
  await page.goto("/radars/jauns?product=x");
  await expect(page).toHaveURL(/\/velmju-saraksts(\?|$)/);
  expect((await request.post("/api/cron/billing")).status()).toBe(401);
  expect((await request.get("/api/account/export")).status()).toBe(401);
});

test("heart while signed out: sign in, the product is saved, back on the same results", async ({ page }) => {
  const email = `e2e-heart-${Date.now()}@example.invalid`;
  await kettleResults(page);
  const url = page.url();
  const first = picks(page).first();
  const name = (await first.getAttribute("aria-label")) ?? "";
  await first.getByRole("button", { name: "Saglabāt", exact: true }).click();

  await expect(page).toHaveURL(/\/ienakt\?callbackUrl=/);
  await signInOnPage(page, email);
  await expect(page).toHaveURL(url);
  await expect(picks(page).first().getByRole("button", { name: "Saglabāts", exact: true })).toBeVisible();

  await page.goto("/velmju-saraksts");
  await expect(page.getByRole("region", { name: "Saglabātās preces" }).getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name })).toBeVisible();
  await deleteAccount(page);
});

test("wishlist: save a search and a product, see today's offer, remove, buy notifications", async ({
  page,
}) => {
  const email = `e2e-wish-${Date.now()}@example.invalid`;
  await devLogin(page, email);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vēlmju saraksts");
  await expect(page.getByText(/Vēl nekas nav saglabāts/)).toBeVisible();
  await expectNoAxeViolations(page);

  // Results: save the whole search, then one product.
  await kettleResults(page);
  await page.getByRole("button", { name: "Saglabāt meklējumu" }).first().click();
  await expect(page.getByRole("button", { name: "Meklējums saglabāts" }).first()).toBeVisible();
  const product = picks(page).first();
  const productName = (await product.getAttribute("aria-label")) ?? "";
  await product.getByRole("button", { name: "Saglabāt", exact: true }).click();
  await expect(product.getByRole("button", { name: "Saglabāts", exact: true })).toBeVisible();
  // Saving says what happens next, with the way out in the same line and the way back.
  const note = product.locator("[data-alert-note]");
  await expect(note).toHaveText("Saglabāts. Nosūtīsim e-pastu, ja cena samazināsies. · Nesūtīt");
  // Trilio's own offers are asked once, with two equal buttons; "no" is remembered.
  const ask = product.getByRole("group", { name: "Vai drīkstam reizēm piedāvāt pašu izdevīgāku cenu?" });
  await ask.getByRole("button", { name: "Nē, paldies" }).click();
  await expect(product.getByRole("status").filter({ hasText: "Labi, nesūtīsim." })).toBeVisible();
  await expectNoAxeViolations(page);
  await note.getByRole("button", { name: "Nesūtīt" }).click();
  await expect(note).toHaveText("Saglabāts. Cenu e-pastus nesūtīsim. · Tomēr sūtīt");
  await note.getByRole("button", { name: "Tomēr sūtīt" }).click();
  await expect(note).toHaveAttribute("data-alert-note", "on");
  // A second tap removes it; a third saves it again.
  await product.getByRole("button", { name: "Saglabāts", exact: true }).click();
  await expect(product.getByRole("button", { name: "Saglabāt", exact: true })).toBeVisible();
  await product.getByRole("button", { name: "Saglabāt", exact: true }).click();
  await expect(product.getByRole("button", { name: "Saglabāts", exact: true })).toBeVisible();
  await expect(product.locator("[data-alert-note]")).toBeVisible();
  // Asked once: the offers question does not come back.
  await expect(product.locator("[data-offers-ask]")).toHaveCount(0);

  // The header heart opens the list.
  await page
    .getByRole("banner")
    .getByRole("link", { name: /Vēlmju saraksts/ })
    .click();
  await expect(page).toHaveURL(/\/velmju-saraksts/);
  await expect(page.getByText("Saglabāti: 2")).toBeVisible();
  const searches = page.getByRole("region", { name: "Saglabātie meklējumi" }).getByRole("article");
  await expect(searches).toHaveCount(1);
  await expect(searches.first()).toHaveAttribute("aria-label", /^Tējkannas/);
  await expect(searches.first().getByText("Labākais variants tagad")).toBeVisible();
  await expect(searches.first().getByText(/Atbilst \d+ prece/)).toBeVisible();
  const products = page.getByRole("region", { name: "Saglabātās preces" }).getByRole("article");
  await expect(products).toHaveCount(1);
  await expect(products.first()).toHaveAttribute("aria-label", productName);
  await expect(products.first().getByRole("link", { name: /^Uz / })).toHaveAttribute("href", /^\/go\//);
  await expectNoAxeViolations(page);

  // The saved search reopens the same results.
  await searches.first().getByRole("link", { name: "Skatīt rezultātus" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
  await expect(page.getByRole("button", { name: "Meklējums saglabāts" }).first()).toBeVisible();
  await page.goBack();

  // Remove the product from the list with its heart.
  await products
    .first()
    .getByRole("button", { name: `Saglabāts: ${productName}` })
    .click();
  await expect(products).toHaveCount(0);
  await expect(page.getByText("Saglabāti: 1")).toBeVisible();

  // Price e-mails are free and on; the threshold applies; off and on again from the list.
  const alerts = page.locator("[data-price-alerts]");
  const box = alerts.getByRole("checkbox", {
    name: "Sūtīt e-pastu, kad saglabātās preces vai meklējuma cena samazinās",
  });
  await expect(box).toBeChecked();
  await expect(alerts.getByText(`Bez maksas. Sūtām uz ${email}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /Ieslēgt paziņojumus/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Vismaz par 5 %" })).toBeChecked();
  await page.getByRole("radio", { name: "Par jebkuru kritumu" }).check();
  // The choice shows at once; wait until it is saved before reloading.
  await expect(page.getByRole("group", { name: "Par kādiem kritumiem ziņot?" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Par jebkuru kritumu" })).toBeChecked();
  await box.uncheck();
  await expect(alerts.getByRole("status")).toHaveText(/Cenu e-pastus nesūtām/);
  await page.reload();
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(alerts.getByRole("status")).toHaveText(/Bez maksas/);
  await expectNoAxeViolations(page);

  // The account page has the same switch.
  await page.goto("/konts");
  await expect(
    page
      .locator("[data-price-alerts]")
      .getByRole("checkbox", { name: "Sūtīt e-pastu, kad saglabātās preces vai meklējuma cena samazinās" }),
  ).toBeChecked();

  // GDPR export carries the wishlist and the setting.
  const res = await page.request.get("/api/account/export");
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.wishlist).toHaveLength(1);
  expect(data.wishlist[0].kind).toBe("search");
  expect(data.notificationSettings[0].threshold).toBe("any");
  expect(data.user.priceAlerts).toBe(true);
  expect(data.user.offersAskedAt).not.toBeNull();

  await deleteAccount(page);
});

test("the retired plan page and the e-mail unsubscribe page need no payment", async ({ page }) => {
  await devLogin(page, `e2e-wish-plan-${Date.now()}@example.invalid`, "/velmju-saraksts/pazinojumi");
  await expect(page).toHaveURL(/\/velmju-saraksts$/);
  await expect(page.getByRole("button", { name: "Maksāt" })).toHaveCount(0);
  await deleteAccount(page);

  // The link in a price e-mail: one button, no sign-in, nothing changes on a GET.
  await page.goto("/velmju-saraksts/atteikties/e2e-not-a-real-token-000000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nesūtīt vairs cenu e-pastus?");
  await page.getByRole("button", { name: "Nesūtīt" }).click();
  await expect(page.getByRole("status")).toHaveText(/Cenu e-pastus vairs nesūtīsim/);
  const res = await page.request.post("/api/wishlist/unsubscribe/e2e-not-a-real-token-000000");
  expect(res.status()).toBe(200);
});
