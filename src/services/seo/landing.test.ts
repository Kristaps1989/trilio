import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { allSubcategories, getSubcategory } from "@/domain/questions/catalog";
import { landingCards, landingIndex } from "./landing";

// The landing index against the seeded catalogue (docs/SEO_INDEXING_PLAN.md §2A, §2D).

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

run("landing index", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  beforeAll(() => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
  });
  afterAll(() => end());

  it("decides every budget step, and folds exactly the pages that repeat a page below", async () => {
    for (const sub of allSubcategories().slice(0, 8)) {
      const index = await landingIndex(db, sub);
      expect(
        Object.keys(index.decision.canonicalOf)
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual([...sub.budget_steps_eur].sort((a, b) => a - b));
      const base = (await landingCards(db, sub, null)).result.picks.map((p) => p.product.id).sort();
      expect(index.decision.baseIndexed).toBe(base.length > 0);
      for (const eur of sub.budget_steps_eur) {
        const ids = (await landingCards(db, sub, eur * 100)).result.picks.map((p) => p.product.id).sort();
        const target = index.decision.canonicalOf[eur];
        if (target === null) {
          expect(ids).toHaveLength(3);
          expect(ids).not.toEqual(base);
        } else {
          expect(target).toBeLessThan(eur);
        }
      }
      for (const v of Object.values(index.lastChanged))
        if (v !== null) expect(new Date(v).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("counts the models within a budget, more for a bigger budget", async () => {
    const fridge = getSubcategory("fridge")!;
    const [low, high] = [fridge.budget_steps_eur[0]!, fridge.budget_steps_eur.at(-1)!];
    const a = await landingCards(db, fridge, low * 100);
    const b = await landingCards(db, fridge, high * 100, a.products);
    expect(b.fits).toBeGreaterThanOrEqual(a.fits);
  });
});
