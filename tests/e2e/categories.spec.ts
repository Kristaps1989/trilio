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
  expect(all.length).toBeGreaterThanOrEqual(39);
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
        const show = page.getByRole("button", { name: /^Rādīt (labākos 3 no \d+|\d+ prec)/ });
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Labākie varianti tev");
    const picks = page.getByRole("region", { name: "Ieteiktie varianti" }).getByRole("article");
    await expect(picks.first()).toBeVisible();
    // The wishlist: the search and every pick can be saved with one tap.
    await expect(page.getByRole("button", { name: "Saglabāt meklējumu" }).first()).toBeVisible();
    await expect(picks.first().getByRole("button", { name: "Saglabāt", exact: true })).toBeVisible();

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

    // A pricier pick is always better overall, and its box says why it is worth more
    // (owner, 23 Oct 2026; docs/UPGRADE_REASONS_PLAN.md).
    const rows = (
      await picks.evaluateAll((els) =>
        els
          .filter((e) => !/Virs budžeta par/.test(e.textContent ?? ""))
          .map((e) => ({
            price: Number(e.querySelector("[data-price-cents]")?.getAttribute("data-price-cents")),
            score: Number(e.getAttribute("data-score")),
            box: e.querySelector("[data-upgrade-gains]")?.textContent ?? null,
            gains: Number(e.querySelector("[data-upgrade-gains]")?.getAttribute("data-upgrade-gains") ?? 0),
          })),
      )
    ).sort((a, b) => a.price - b.price);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]!.price > rows[i - 1]!.price)
        expect(rows[i]!.score, `${sub.id}: a pricier pick must score higher`).toBeGreaterThan(
          rows[i - 1]!.score,
        );
    }
    for (const r of rows) {
      if (r.box === null) continue;
      expect(r.box, `${sub.id}: the box names the price difference`).toMatch(/^Par \+/);
      if (/Bet:/.test(r.box))
        expect(
          r.gains > 0 || /nevienā parametrā būtiski labāks/.test(r.box),
          `${sub.id}: downsides never stand alone: ${r.box}`,
        ).toBe(true);
    }

    // Three options a shopper can trust (docs/CONFIDENCE_PLAN.md): every pick argues for itself,
    // every role pill is one the page's own data says it earned, and no composite score is shown.
    await expect(page.locator("[data-coverage]")).toContainText(/Izskatījām \d+/);
    const story = await picks.evaluateAll((els) =>
      els.map((e) => ({
        price: Number(e.querySelector("[data-price-cents]")?.getAttribute("data-price-cents")),
        verdict: e.querySelector("[data-verdict]")?.textContent?.trim() ?? "",
        proofs: e.querySelectorAll("[data-proofs] li").length,
        roles: (e.getAttribute("data-roles") ?? "").split(" ").filter(Boolean),
        pills: e.querySelectorAll("[data-role-pill]").length,
      })),
    );
    for (const c of story) {
      expect(c.verdict.length, `${sub.id}: every pick has a verdict`).toBeGreaterThan(10);
      expect(c.proofs, `${sub.id}: every pick has proof`).toBeGreaterThan(0);
      expect(c.pills, `${sub.id}: one pill per earned role`).toBe(c.roles.length);
    }
    for (const role of ["sensible", "priority", "lasting", "cheapest_good"])
      expect(
        story.filter((c) => c.roles.includes(role)).length,
        `${sub.id}: ${role} once`,
      ).toBeLessThanOrEqual(1);
    const cheapestRole = story.find((c) => c.roles.includes("cheapest_good"));
    if (cheapestRole)
      expect(cheapestRole.price, `${sub.id}: the cheapest-we-would-buy is the cheapest pick`).toBe(
        Math.min(...story.map((c) => c.price)),
      );
    await expect(page.getByText(/Vērtējums \d+,\d\/10/)).toHaveCount(0);

    // New and refurbished never mix (product rule 1).
    await expect(picks.filter({ hasText: /Atjaunota/ })).toHaveCount(0);
    if (AXE.has(sub.id)) await expectNoAxeViolations(page);
  });
}
