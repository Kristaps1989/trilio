import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import postgres from "postgres";

// The 8 Nov 2026 UX review (docs/UX_REVIEW_PLAN.md): a cookie bar that leaves the
// page to the page, a home page that says what Trilio does, one-screen
// "Iegūt lētāk" with a response time and anonymous proof, a card with one
// primary action and its worth in euro.

const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

async function noAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe("before any consent choice", () => {
  // Every other spec starts with consent declined (playwright.config.ts); this one starts fresh.
  test.use({ storageState: { cookies: [], origins: [] } });
  test("the cookie bar is two short lines with equal answers, not half the screen", async ({ page }) => {
    await page.goto("/");
    const bar = page.locator("[data-consent-bar]");
    await expect(bar).toBeVisible();
    // It still names who sets the cookies and links the policy.
    await expect(bar).toContainText("Google un Meta sīkdatnes");
    await expect(bar.getByRole("link", { name: "Sīkāk" })).toHaveAttribute("href", "/sikdatnes");
    const box = (await bar.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.height).toBeLessThanOrEqual(Math.max(130, viewport.height * 0.18));
    // Refusing is as easy as accepting: same size, same style.
    const no = (await bar.getByRole("button", { name: "Neatļaut", exact: true }).boundingBox())!;
    const yes = (await bar.getByRole("button", { name: "Atļaut", exact: true }).boundingBox())!;
    expect(Math.abs(no.height - yes.height)).toBeLessThan(1);
    await noAxe(page);
  });
});

test("the home page says what Trilio does and starts the choice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Trīs labākās preces tev — un zemāka cena, ja to varam panākt.",
  );
  await expect(page.getByText("pajautājam izplatītājam zemāku cenu", { exact: false }).first()).toBeVisible();
  // The first question is the action (owner, 12 Nov 2026): the group tiles, no separate button.
  await expect(page.getByRole("heading", { level: 2, name: "Ko tu meklē?" })).toBeVisible();
  await expect(
    page.locator("[data-home-start]").getByRole("link", { name: "Ledusskapji un saldētavas" }),
  ).toHaveAttribute("href", "/izvelies/cool");
  // The model check is a plain link, not a second big button.
  const model = page.getByRole("link", { name: "Es jau zinu modeli" });
  await expect(model).toBeVisible();
  expect(await model.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("underline");
});

test("the card: the request first and lime with its worth in euro, the shop second and outlined", async ({
  page,
}) => {
  await page.goto("/rezultati?sub=kettle");
  const card = picks(page).first();
  const ask = card.getByRole("button", { name: "Iegūt lētāk", exact: true });
  await expect(ask).toBeVisible();
  // The euro amount describes the button; its name stays "Iegūt lētāk".
  await expect(ask).toHaveAccessibleDescription(/^līdz −\d+(\s\d{3})*\s€$/);
  const buy = card.getByRole("link", { name: /^Pirkt — / });
  const bg = await buy.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
  // The model code and EAN stay on the card, below the facts.
  await expect(card.locator("[data-card-ean]")).toContainText("Modelis");
});

test.describe("anonymous proof from a real saving", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(() => !process.env.DATABASE_URL, "needs the database");

  const SHOPPER = "E2E Proof Pircējs";
  const PRODUCT = "E2E Proof Ledusskapis XYZ-123";
  let sql: ReturnType<typeof postgres>;
  let offerId = "";

  test.beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const stamp = Date.now();
    const [o] = await sql<{ id: string }[]>`
      insert into special_offers (token, product_name, subcategory_id, price_cents, reference_price_cents,
        reference_store_name, valid_until, created_by, status)
      values (${`e2e-proof-${stamp}`}, ${PRODUCT}, 'fridge', 49900, 54900, 'E2E Veikals',
        now() + interval '7 days', 'e2e', 'paid')
      returning id`;
    offerId = o!.id;
    await sql`
      insert into offer_orders (offer_id, number, status, amount_cents, full_name, email, feedback_token, paid_at)
      values (${offerId}, ${`E2E-P-${stamp}`}, 'paid', 49900, ${SHOPPER}, 'e2e-proof@example.invalid',
        ${`e2e-proof-fb-${stamp}`}, now())`;
  });

  test.afterAll(async () => {
    await sql`delete from offer_orders where offer_id = ${offerId}`;
    await sql`delete from special_offers where id = ${offerId}`;
    await sql.end();
  });

  test("the home page and the question before the shop show it, without who, what or where", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "desktop", "the proof is shared state");
    await page.goto("/");
    const home = page.locator("[data-home-proof]");
    await expect(home).toContainText("50 €");
    await expect(home).toContainText("ledusskapis");
    for (const secret of [SHOPPER, PRODUCT, "E2E Veikals", "e2e-proof"])
      await expect(home).not.toContainText(secret);

    await page.goto("/rezultati?sub=kettle");
    await picks(page)
      .first()
      .getByRole("link", { name: /^Pirkt — / })
      .click();
    const sheet = page.getByRole("dialog", { name: "Pirms pērc — pajautāsim zemāku cenu" });
    await expect(sheet.locator("[data-ask-proof]")).toContainText("50 €");
    for (const secret of [SHOPPER, PRODUCT, "E2E Veikals"]) await expect(sheet).not.toContainText(secret);
  });
});
