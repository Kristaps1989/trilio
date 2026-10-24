import { describe, expect, it } from "vitest";
import {
  allSubcategories,
  catalog,
  catalogIn,
  catalogText,
  getGroup,
  getGroupOfSubcategory,
  getSubcategory,
} from "./catalog";

// data/categories.en.json is a translation of categories.json keyed by ids
// (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §4.4). These checks keep the two in
// step: every id it names exists, and every text categories.json has is
// translated, so an added question cannot ship half in Latvian.

describe("English catalog text", () => {
  it("names only groups, subcategories, questions and options that exist", () => {
    const groupIds = new Set(catalog.groups.map((g) => g.id));
    for (const id of Object.keys(catalogText.groups)) expect(groupIds, id).toContain(id);
    for (const [subId, st] of Object.entries(catalogText.subcategories)) {
      const sub = getSubcategory(subId);
      expect(sub, subId).toBeDefined();
      for (const [qId, qt] of Object.entries(st.questions ?? {})) {
        const q = sub!.questions.find((x) => x.id === qId);
        expect(q, `${subId}.${qId}`).toBeDefined();
        for (const value of Object.keys(qt.options ?? {}))
          expect(
            q!.options.map((o) => o.value),
            `${subId}.${qId}.${value}`,
          ).toContain(value);
      }
    }
  });

  it("translates every text field", () => {
    const missing: string[] = [];
    for (const g of catalog.groups) {
      if (!catalogText.groups[g.id]?.label) missing.push(g.id);
      for (const s of g.subcategories) {
        const st = catalogText.subcategories[s.id];
        if (!st?.label) missing.push(`${s.id}.label`);
        if (s.description && !st?.description) missing.push(`${s.id}.description`);
        for (const q of s.questions) {
          const qt = st?.questions?.[q.id];
          for (const f of ["title", "why", "help"] as const)
            if (q[f] && !qt?.[f]) missing.push(`${s.id}.${q.id}.${f}`);
          for (const o of q.options) {
            const ot = qt?.options?.[o.value];
            for (const f of ["label", "sublabel", "card_reason", "table_value"] as const)
              if (o[f] && !ot?.[f]) missing.push(`${s.id}.${q.id}.${o.value}.${f}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("changes only the text: ids, rules and budgets are the same", () => {
    const strip = (c: typeof catalog) =>
      c.groups.map((g) => ({
        id: g.id,
        subs: g.subcategories.map((s) => ({
          id: s.id,
          budget: s.budget_steps_eur,
          compare: s.compare,
          questions: s.questions.map((q) => ({
            id: q.id,
            type: q.type,
            stage: q.stage,
            showIf: q.showIf,
            options: q.options.map((o) => ({ value: o.value, match: o.match, implies: o.implies })),
          })),
        })),
      }));
    expect(strip(catalogIn("en"))).toEqual(strip(catalogIn("lv")));
  });

  it("serves the language asked for, Latvian by default", () => {
    expect(getGroup("cool")?.label).toBe("Ledusskapji un saldētavas");
    expect(getGroup("cool", "en")?.label).toBe("Fridges and freezers");
    expect(getSubcategory("fridge", "en")?.label).toBe("Fridges");
    expect(getGroupOfSubcategory("fridge", "en")?.id).toBe("cool");
    expect(getSubcategory("nope", "en")).toBeUndefined();
    expect(allSubcategories("en").map((s) => s.id)).toEqual(allSubcategories().map((s) => s.id));
    const install = getSubcategory("fridge", "en")!.questions[0]!;
    expect(install.title).toBe("Freestanding or built-in?");
    expect(install.options.map((o) => o.label)).toEqual(["Freestanding", "Built-in"]);
  });
});
