import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Three options a shopper can trust (docs/CONFIDENCE_PLAN.md), against the
// seeded sample data: coverage, roles, verdicts, the catch, "Kāpēc ne šie?",
// visible priorities, the grouped compare table, shop reviews and the
// confidence question with its admin numbers.

const ADMIN = "e2e-admin@example.invalid";

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

const picks = (page: Page) => page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");

test("the results page tells its story: coverage, roles, the product then its verdict, and the catch", async ({
  page,
}) => {
  await page.goto("/rezultati?sub=fridge");
  await expect(page.locator("[data-coverage]")).toHaveText(
    /^Izskatījām \d+ preces? \d+ veikal(ā|os)( \(atjaunots .+\))?\. \d+ der tavām atbildēm un budžetam\. Šie ir labākie — un lūk, kāpēc\.$/,
  );
  const cards = picks(page);
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    // The product is the hero (owner, 1 Nov 2026): photo, name and price, then the verdict.
    const order = await card.evaluate((e) => {
      const verdict = e.querySelector("[data-verdict]");
      const price = e.querySelector("[data-price-cents]");
      return verdict && price ? price.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy();
    await expect(card.locator("[data-proofs] li").first()).toBeVisible();
  }
  // Roles replace price tiers.
  await expect(page.getByText(/^(Budžeta variants|Vidējā klase|Augstākā klase)$/)).toHaveCount(0);
  await expect(page.locator("[data-role-pill]").first()).toBeVisible();
  // The catch is measured against the best available, not only the cheaper card.
  await expect(page.locator("[data-catch]").first()).toHaveText(/^Bet: /);
  await expect(page.getByText(/\/10$/)).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test("priorities are one tap away and re-rank with the same URL", async ({ page }) => {
  await page.goto("/rezultati?sub=fridge");
  const row = page.getByRole("navigation", { name: "Kas tev svarīgāk?" });
  await expect(row.getByRole("link", { name: "Vienalga" })).toHaveAttribute("aria-current", "true");
  await row.getByRole("link", { name: "Klusums" }).click();
  await expect(page).toHaveURL(/rezultati\?sub=fridge&a=/);
  await expect(row.getByRole("link", { name: "Klusums" })).toHaveAttribute("aria-current", "true");
  // A priority role, when earned, goes to the quietest pick.
  const quiet = page.locator('article[data-roles~="priority"]');
  if ((await quiet.count()) > 0) {
    await expect(
      quiet.locator("[data-role-pill]").filter({ hasText: "Ja klusums ir galvenais" }),
    ).toHaveCount(1);
    await expect(quiet.locator("[data-verdict]")).toContainText(/Klusākais/);
  }
  await row.getByRole("link", { name: "Vienalga" }).click();
  await expect(row.getByRole("link", { name: "Vienalga" })).toHaveAttribute("aria-current", "true");
});

test("why not these: real products with the reason each was not picked", async ({ page }) => {
  await page.goto("/rezultati?sub=fridge");
  const box = page.locator("[data-why-not]");
  await expect(box).toBeVisible();
  await box.getByText("Kāpēc ne šie?").click();
  const items = box.locator("[data-why-not-item]");
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeLessThanOrEqual(4);
  const pickNames = await picks(page).locator("h3").allTextContents();
  for (const item of await items.all()) {
    const text = (await item.textContent()) ?? "";
    expect(pickNames.some((n) => text.startsWith(n.trim()))).toBe(false);
    // Every line states a reason after the name and price.
    await expect(item.locator("span").last()).toHaveText(/\S{4,}/);
  }
  await expectNoAxeViolations(page);
});

test("compare table in groups, with reviews and an explanation for features", async ({ page }) => {
  await page.goto("/rezultati?sub=fridge");
  await page.getByRole("button", { name: "Salīdzināt parametrus blakus" }).click();
  const table = page.getByRole("table");
  for (const group of ["Modelis un cena", "Ikdienā", "Izmēri", "Uzticamība un garantija"])
    await expect(table.getByRole("columnheader", { name: group })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "Zīmola uzticamība" })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: /Trilio vērtējums/ })).toHaveCount(0);
  const hint = table.locator("details").first();
  if ((await hint.count()) > 0) {
    await hint.locator("summary").click();
    await expect(hint).toHaveAttribute("open", "");
  }
  await expectNoAxeViolations(page);
});

test("shop reviews show only with a count, never as a Trilio score", async ({ page }) => {
  await page.goto("/rezultati?sub=kettle");
  const stars = page.getByText(/^\d,\d ★ · \d+ atsauksmes? \d+ veikal(ā|os)$/);
  await expect(stars.first()).toBeVisible();
  for (const text of await stars.allTextContents()) {
    const count = Number(text.match(/· (\d+) atsauksm/)![1]);
    expect(count).toBeGreaterThanOrEqual(10);
  }
});

test("the English page argues in English", async ({ page }) => {
  await page.goto("/en/rezultati?sub=fridge");
  await expect(page.locator("[data-coverage]")).toHaveText(/^We looked at \d+ products? in \d+ shops?/);
  await expect(page.getByRole("navigation", { name: "What matters more to you?" })).toBeVisible();
  await expect(page.locator("[data-verdict]").first()).not.toHaveText(/[āēīūšžčķļņģ]{2,}/);
});

test("the confidence question is one tap, and the admin sees the answer", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "one project writes the shared answers");
  await page.goto("/rezultati?sub=fridge");
  const q = page.getByRole("region", { name: "Vai šie varianti deva pārliecību izvēlēties?" });
  const note = `e2e: pietrūka ${Date.now()}`;
  await q.getByRole("button", { name: "Nē, kaut kā pietrūka" }).click();
  await q.getByLabel("Kā pietrūka? (nav obligāti)").fill(note);
  await q.getByRole("button", { name: "Nosūtīt" }).click();
  await expect(q.getByRole("status")).toHaveText("Paldies — tas palīdz mums kļūt labākiem.");
  expect(
    (
      await page.request.post("/api/confidence", { data: { subcategoryId: "nope", confident: true } })
    ).status(),
  ).toBe(400);

  await page.goto(`/ienakt?callbackUrl=${encodeURIComponent("/admin/statistika?periods=today")}`);
  await page.getByLabel("E-pasts").last().fill(ADMIN);
  await page.getByRole("button", { name: "Ienākt bez paroles" }).click();
  await page.waitForURL(/\/admin\/statistika/);
  const section = page.getByRole("region", { name: "Pārliecība" });
  await expect(section.getByText(note)).toBeVisible();
  await expect(section.getByText("Rezultātu skatījumi", { exact: true })).toBeVisible();
});
