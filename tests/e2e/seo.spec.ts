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
  const first = data.itemListElement[0].item;
  expect(first.offers).toMatchObject({ "@type": "AggregateOffer", priceCurrency: "EUR" });
  expect(Number(first.offers.lowPrice)).toBeLessThanOrEqual(Number(first.offers.highPrice));
  expect(first.offers.offerCount).toBeGreaterThan(0);
  expect(first.description).toBeTruthy();
  expect(data.itemListElement[0].item.gtin13).toMatch(/^\d{13}$/);
  await expect(page.getByText("Atbildi uz dažiem jautājumiem, un atlasīsim tieši tev")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sākt izvēli" })).toHaveAttribute(
    "href",
    "/izvelies/cool/fridge",
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("budget landing page keeps every card within the budget and links the other steps", async ({ page }) => {
  await page.goto("/kategorija/fridge/lidz-800");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Labākie ledusskapji līdz 800\s€/);
  const prices = await page
    .getByRole("article")
    .locator("[data-price-cents]")
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-price-cents"))));
  expect(prices.length).toBeGreaterThan(0);
  for (const cents of prices) expect(cents).toBeLessThanOrEqual(80000);
  await expect(page.getByRole("link", { name: /līdz 800\s€/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /līdz 1\s200\s€/ })).toBeVisible();
  // A sentence only this budget page can say, from the data (docs/SEO_INDEXING_PLAN.md §2C).
  await expect(page.locator("[data-budget-summary]")).toContainText(
    /^Līdz 800\s€ partneru veikalos ir \d+ model/,
  );
  expect((await page.goto("/kategorija/fridge/lidz-999"))!.status()).toBe(404);
  expect((await page.goto("/kategorija/nope"))!.status()).toBe(404);
});

test("home page links every category page and llms.txt describes the site", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Populārākās kategorijas" })).toBeVisible();
  const links = await page.locator('a[href^="/kategorija/"]').count();
  expect(links).toBe(39);
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
  expect(xml).toContain("/kategorija/fridge</loc>");
  expect(xml).toContain("/kategorija/kettle</loc>");
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

test("no-budget landing stays in the usual price range, agrees in gender and links its group", async ({
  page,
}) => {
  await page.goto("/kategorija/freezer");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Labākās saldētavas");
  await expect(page).toHaveTitle(/^Labākās saldētavas \d{4}: cenas un salīdzinājums · Trilio$/);
  const lead = await page.getByText(/biežākajā cenu robežā līdz/).textContent();
  const max = Number(/līdz ([\d\s ]+)\s€/.exec(lead ?? "")![1]!.replace(/\D/g, "")) * 100;
  const prices = await page
    .getByRole("article")
    .locator("[data-price-cents]")
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-price-cents"))));
  expect(prices.length).toBeGreaterThan(0);
  for (const cents of prices) expect(cents).toBeLessThanOrEqual(max);
  await expect(page.getByRole("link", { name: "Labākie ledusskapji" })).toHaveAttribute(
    "href",
    "/kategorija/fridge",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/og\.png$/);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", /\/kategorija\/freezer$/);
});

test("search and question pages stay out of the index; entry pages carry a canonical", async ({ page }) => {
  await page.goto("/modelis?q=bosch");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.goto("/izvelies/cool/fridge");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  for (const path of ["/izvelies", "/izvelies/cool", "/modelis"]) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path}$`));
  }
  expect((await page.request.get("/og.png")).headers()["content-type"]).toBe("image/png");
});

// docs/SEO_INDEXING_PLAN.md §2A: one address per distinct set of picks.
test("a budget page that repeats a page below names it as canonical and leaves the sitemap", async ({
  page,
  request,
}) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  const listed = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname));
  let folded = 0;
  let kept = 0;
  for (const sub of ["fridge", "freezer", "washer", "kettle", "vacuum"]) {
    await page.goto(`/kategorija/${sub}`);
    const steps = await page
      .getByRole("navigation", { name: "Pēc budžeta" })
      .getByRole("link")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    for (const path of steps) {
      await page.goto(path);
      const canonical = new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!).pathname;
      const en = new URL((await page.locator('link[rel="alternate"][hreflang="en"]').getAttribute("href"))!)
        .pathname;
      expect(en).toBe(`/en${canonical}`);
      if (canonical === path) {
        kept++;
        expect(listed.has(path), `${path} is distinct and listed`).toBe(true);
        expect(listed.has(`/en${path}`)).toBe(true);
      } else {
        folded++;
        expect(listed.has(path), `${path} folds into ${canonical}`).toBe(false);
        expect(listed.has(canonical)).toBe(true);
        // The English page follows the Latvian decision.
        await page.goto(`/en${path}`);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
          "href",
          new RegExp(`/en${canonical}$`),
        );
      }
    }
  }
  expect(folded).toBeGreaterThan(0);
  expect(kept).toBeGreaterThan(0);
  // Dates come from price changes, never later than now; pages without prices carry none.
  const home = /<url>\s*<loc>[^<]*\/<\/loc>([\s\S]*?)<\/url>/.exec(xml)![1]!;
  expect(home).not.toContain("<lastmod>");
  for (const m of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g))
    expect(new Date(m[1]!).getTime()).toBeLessThanOrEqual(Date.now());
});

test("landing cards name the brand and say what the product is", async ({ page }) => {
  await page.goto("/kategorija/fridge");
  const names = await page.getByRole("article").locator("h3").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toMatch(/ledusskap|saldētav/i);
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).flatMap((b) =>
    JSON.parse(b),
  );
  const list = ld.find((x: { "@type": string }) => x["@type"] === "ItemList");
  for (const el of list.itemListElement) expect(el.item.name).toMatch(/ledusskap|saldētav/i);
});
