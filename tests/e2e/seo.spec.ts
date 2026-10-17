import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Phase 3: SEO landing pages per category and budget, sitemap and robots.

test("category landing page renders three ranked cards with structured data and a canonical URL", async ({
  page,
}) => {
  await page.goto("/kategorija/fridge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Labākie ledusskapji");
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/kategorija\/fridge$/);
  const ldBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const all = ldBlocks.flatMap((b) => JSON.parse(b));
  const data = all.find((x: { "@type": string }) => x["@type"] === "ItemList");
  expect(all.find((x: { "@type": string }) => x["@type"] === "BreadcrumbList").itemListElement).toHaveLength(
    3,
  );
  expect(all.find((x: { "@type": string }) => x["@type"] === "FAQPage").mainEntity).toHaveLength(3);
  expect(all.find((x: { "@type": string }) => x["@type"] === "Organization").name).toBe("Trilio");
  expect(all.find((x: { "@type": string }) => x["@type"] === "WebSite").potentialAction["@type"]).toBe(
    "SearchAction",
  );
  expect(data.itemListElement).toHaveLength(3);
  expect(data.itemListElement[0].item.offers.priceCurrency).toBe("EUR");
  expect(data.itemListElement[0].item.gtin13).toMatch(/^\d{13}$/);
  await expect(page.getByRole("link", { name: /Atbildi uz dažiem jautājumiem/ })).toHaveAttribute(
    "href",
    "/izvelies/cool/fridge",
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("budget landing page keeps every card within the budget and links the other steps", async ({ page }) => {
  await page.goto("/kategorija/fridge/lidz-800");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Labākie ledusskapji līdz 800\s€/);
  const prices = await page.getByRole("article").locator("p.font-heading").allTextContents();
  expect(prices.length).toBeGreaterThan(0);
  for (const p of prices) {
    const eur = Number(p.replace(/[^\d]/g, "").slice(0, 4));
    expect(eur).toBeLessThanOrEqual(800);
  }
  await expect(page.getByRole("link", { name: /līdz 800\s€/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /līdz 1\s200\s€/ })).toBeVisible();
  expect((await page.goto("/kategorija/fridge/lidz-999"))!.status()).toBe(404);
  expect((await page.goto("/kategorija/nope"))!.status()).toBe(404);
});

test("home page links every category page and llms.txt describes the site", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Populārākās kategorijas" })).toBeVisible();
  const links = await page.locator('a[href^="/kategorija/"]').count();
  expect(links).toBe(33);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Trilio");
  const llms = await request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(llms.headers()["content-type"]).toContain("text/plain");
  const txt = await llms.text();
  expect(txt).toContain("# Trilio");
  expect(txt).toContain("/kategorija/fridge/lidz-800");
});

test("sitemap and robots are served", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain("/kategorija/fridge/lidz-800");
  expect(xml).toContain("/kategorija/kettle");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const txt = await robots.text();
  expect(txt).toContain("Disallow: /api/");
  expect(txt).toContain("Disallow: /go/");
  expect(txt).toContain("Sitemap:");
  expect(txt).toContain("User-Agent: GPTBot");
  expect(txt).toContain("User-Agent: ClaudeBot");
  expect(txt).toContain("User-Agent: Google-Extended");
});
