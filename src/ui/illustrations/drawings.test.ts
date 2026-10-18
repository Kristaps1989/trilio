import { describe, expect, it } from "vitest";
import raw from "../../../data/categories.json";
import { DRAWINGS } from "./drawings";

type Option = { illustration?: string };
type Question = { options?: Option[] };
type Catalog = { groups: { subcategories: { questions: Question[] }[] }[] };

function usedIllustrations(): Set<string> {
  const names = new Set<string>();
  for (const group of (raw as unknown as Catalog).groups) {
    for (const sub of group.subcategories) {
      for (const question of sub.questions) {
        for (const option of question.options ?? []) {
          if (option.illustration) names.add(option.illustration);
        }
      }
    }
  }
  return names;
}

describe("DRAWINGS", () => {
  const used = usedIllustrations();

  it("has a drawing for every illustration referenced in categories.json", () => {
    const missing = [...used].filter((name) => !(name in DRAWINGS));
    expect(missing).toEqual([]);
  });

  it("has no unused drawings", () => {
    const unused = Object.keys(DRAWINGS).filter((name) => !used.has(name));
    expect(unused).toEqual([]);
  });
});
