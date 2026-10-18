import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Phase 2 journey with the dev login and the mock payment provider:
// sign in → "Sekot cenai" → three questions → plan → mock checkout →
// confirmation → radar page (pause, filters, stop + undo, cancel + resume)
// → account export. Runs against the seeded sample data.

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function devLogin(page: Page, email: string, callbackUrl = "/radars") {
  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  await page.getByLabel("E-pasts").last().fill(email);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/ienakt"));
}

test.describe.configure({ mode: "serial" });

test("radar: signed-out page shows sign-in only; cron and push endpoints need auth", async ({
  page,
  request,
}) => {
  await page.goto("/radars");
  await expect(page.getByText("Ienāc, lai redzētu savu cenu radaru.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ienākt" }).last()).toBeVisible();
  await expectNoAxeViolations(page);
  expect((await request.post("/api/cron/billing")).status()).toBe(401);
  expect((await request.post("/api/push/subscribe", { data: {} })).status()).toBe(401);
  expect((await request.get("/api/account/export")).status()).toBe(401);
  // Unknown callback is acknowledged without side effects
  const cb = await request.post("/api/payments/callback", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: "notification_id=does-not-exist",
  });
  expect(cb.status()).toBe(200);
});

test("radar: full journey from results to a working radar page", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.invalid`;
  await devLogin(page, email, "/radars");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cenu radars");
  await expect(page.getByText("Vēl neseko nevienai cenai")).toBeVisible();

  // From results: "Sekot cenai" on the first card
  await page.goto("/izvelies/kitchensmall/kettle");
  await page.getByRole("button", { name: "Tālāk", exact: true }).click();
  await page.getByRole("button", { name: "Budžets nav noteikts" }).click();
  await expect(page).toHaveURL(/\/rezultati\?sub=kettle/);
  await page.getByRole("link", { name: "Sekot cenai" }).first().click();

  // Three setup questions
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kad tev paziņot?");
  await expectNoAxeViolations(page);
  await page.getByRole("radio", { name: /vismaz par 5 %/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/citiem modeļiem/);
  await page.getByRole("radio", { name: /Tikai par šo modeli/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kā tev paziņot?");
  await page.getByRole("radio", { name: /^E-pasts/ }).click();

  // Signed in but not subscribed → plan screen → mock checkout
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cenu radars");
  await expect(page.getByText(/Kartes datus apstrādā Paysera/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /12 € gadā/ })).toHaveAttribute("aria-checked", "true");
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Maksāt" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mock checkout");
  await page.getByRole("button", { name: "Maksāt (tests)" }).click();

  // Confirmation → radar page
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Radars ieslēgts!");
  await page.getByRole("link", { name: "Uz radara lapu" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cenu radars");
  const card = page.getByRole("article").first();
  await expect(card).toBeVisible();
  await expect(card.getByText(/kritums vismaz 5 %/)).toBeVisible();
  await expect(card.getByText(/visi veikali/)).toBeVisible();
  await expect(page.getByText(/Karte •••• 4242/)).toBeVisible();
  await expectNoAxeViolations(page);

  // Pause / resume
  await card.getByRole("switch").click();
  await expect(page.getByRole("article").first().getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.getByRole("article").first().getByRole("switch").click();
  await expect(page.getByRole("article").first().getByRole("switch")).toHaveAttribute("aria-checked", "true");

  // Filters: change threshold to 10 %
  await page.getByRole("article").first().getByRole("button", { name: "Mainīt" }).click();
  await page
    .getByRole("article")
    .first()
    .getByRole("radio", { name: /vismaz par 10 %/ })
    .check();
  await page.getByRole("article").first().getByRole("button", { name: "Saglabāt" }).click();
  await expect(
    page
      .getByRole("article")
      .first()
      .getByText(/kritums vismaz 10 %/),
  ).toBeVisible();

  // Stop with undo
  await page.getByRole("article").first().getByRole("button", { name: "Pārtraukt sekot" }).click();
  await expect(page.getByRole("status")).toContainText("Sekošana pārtraukta");
  await page.getByRole("button", { name: "Atsaukt" }).click();
  await expect(page.getByRole("article").first()).toBeVisible();

  // Cancel subscription with confirmation, then resume
  await page.getByRole("button", { name: "Atteikties no abonementa" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Tiešām atteikties?");
  await page.getByRole("button", { name: "Jā, atteikties" }).click();
  await expect(page.getByText(/Abonements beigsies/)).toBeVisible();
  await page.getByRole("button", { name: "Atjaunot abonementu" }).click();
  await expect(page.getByText(/spēkā līdz/)).toBeVisible();

  // Already subscribed: a second radar skips the plan and payment
  await page.goto("/modelis?q=KGN39VLCT");
  await page.getByRole("link", { name: "Sekot cenai" }).first().click();
  await page.getByRole("radio", { name: /jebkuru kritumu/ }).click();
  await page.getByRole("radio", { name: /citiem Bosch modeļiem/ }).click();
  await page.getByRole("radio", { name: /^Abi/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Radars ieslēgts!");
  await page.goto("/radars");
  await expect(page.getByRole("article")).toHaveCount(2);

  // GDPR export
  const res = await page.request.get("/api/account/export");
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.user.email).toBe(email);
  expect(data.radars).toHaveLength(2);
  expect(data.subscriptions[0].status).toBe("active");
  expect(JSON.stringify(data)).not.toContain("mock-token");

  // Delete account
  await page.goto("/konts");
  await page.getByRole("button", { name: "Dzēst kontu" }).click();
  await page.getByRole("button", { name: "Jā, dzēst" }).click();
  await page.waitForURL(/\/\?deleted=1/);
  await page.goto("/radars");
  await expect(page.getByText("Ienāc, lai redzētu savu cenu radaru.")).toBeVisible();
});

test("payment cancelled on the hosted page returns to the plan without charging", async ({ page }) => {
  await devLogin(page, `e2e-cancel-${Date.now()}@example.invalid`, "/radars/jauns?step=plan");
  await expect(page.getByRole("button", { name: "Maksāt" })).toBeVisible();
  await page.getByRole("button", { name: "Maksāt" }).click();
  await page.getByRole("button", { name: "Atcelt" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Maksājums atcelts");
  await page.goto("/radars");
  await expect(page.getByText("Nav aktīva abonementa.")).toBeVisible();
});
