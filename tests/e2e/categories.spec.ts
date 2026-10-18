import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Every category, end to end, against the seeded sample data: walk the flow
// taking the pre-selected answers (core rule: a sensible default is always
// selected), reach results, and check that the picks respect the price range.
// The question list comes from data/categories.json, so a new category is
// covered without touching this file.

type Sub = { id: string; label: string };
type Group = { id: string; subcategories: Sub[] };
const catalog = JSON.parse(readFileSync("data/categories.json", "utf8")) as { groups: Group[] };
const all = catalog.groups.flatMap((g) => g.subcategories.map((s) => ({ group: g.id, sub: s })));

// Axe on the flow and results of a few representative categories (the screens share components).
const AXE = new Set(["fridge", "washer", "coffee", "vacuum", "kettle"]);

async function expectNoAxeViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/); // a client navigation sets the title a moment later
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** "1 079 €" → 1079 (spaces may be normal, no-break or thin). */
export function euros(text: string): number {
  const m = text.match(/([\d\s   ]+)\s*€/);
  if (!m) throw new Error(`no price in "${text}"`);
  return Number(m[1]!.replace(/[\s   ]/g, ""));
}

test("all categories are in the test list", () => {
  expect(all.length).toBeGreaterThanOrEqual(33);
});

for (const { group, sub } of all) {
  test(`${sub.id}: default answers reach results within the price range`, async ({ page }) => {
    await page.goto(`/izvelies/${group}/${sub.id}`);
    const seen: string[] = [];

    for (let step = 0; step < 12 && !page.url().includes("/rezultati"); step++) {
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      const title = (await heading.textContent()) ?? "";
      expect(seen, "no question is asked twice").not.toContain(title);
      seen.push(title);
      if (step === 0 && AXE.has(sub.id)) await expectNoAxeViolations(page);

      if (await page.getByRole("slider", { name: "Augstākā cena, eiro" }).count()) {
        // Price screen: the default range is the middle of what is in stock, so it has products.
        const show = page.getByRole("button", { name: /^Rādīt \d+ prec/ });
        await expect(show).toBeEnabled();
        await show.click();
      } else {
        // Choice and range screens: a default is pre-selected and is never an empty option.
        const radios = page.getByRole("main").getByRole("radio");
        if (await radios.count()) {
          const checked = page.getByRole("main").getByRole("radio", { checked: true });
          await expect(checked).toHaveCount(1);
          await expect(checked).not.toContainText("Pašlaik nav pieejams");
        }
        await page.getByRole("button", { name: "Tālāk", exact: true }).click();
      }
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(title);
    }

    await expect(page).toHaveURL(new RegExp(`/rezultati\\?sub=${sub.id}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trīs labākie varianti tev");
    const picks = page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");
    await expect(picks.first()).toBeVisible();

    // The chosen price range is a chip; every pick inside it, unless labelled over budget.
    const chips = page.getByRole("navigation", { name: "Tavas izvēles" }).getByRole("button");
    // (A default range that spans all stock is no limit: the chip says "Jebkura cena".)
    const priceChip = chips.filter({ hasText: /€–.*€|Jebkura cena|līdz .*€|no .*€/i });
    await expect(priceChip).toHaveCount(1);
    const chipText = (await priceChip.textContent()) ?? "";
    const prices = [...chipText.matchAll(/([\d\s\u00a0\u2009\u202f]+)\s*€/g)].map((m) => euros(m[0]));
    const lo = /^līdz/i.test(chipText) ? 0 : (prices[0] ?? 0);
    const hi = /^no /i.test(chipText) ? Infinity : (prices[prices.length - 1] ?? Infinity);
    for (const card of await picks.all()) {
      const text = (await card.textContent()) ?? "";
      if (/Virs budžeta par/.test(text)) continue;
      const price =
        Number(await card.locator("[data-price-cents]").first().getAttribute("data-price-cents")) / 100;
      expect(price, `${sub.id}: ${text.slice(0, 60)}`).toBeGreaterThanOrEqual(lo);
      expect(price, `${sub.id}: ${text.slice(0, 60)}`).toBeLessThanOrEqual(hi);
    }

    // New and refurbished never mix (product rule 1).
    await expect(picks.filter({ hasText: /Atjaunota/ })).toHaveCount(0);
    if (AXE.has(sub.id)) await expectNoAxeViolations(page);
  });
}
