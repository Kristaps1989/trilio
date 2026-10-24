import { describe, expect, it } from "vitest";
import en from "./messages/en.json";
import lv from "./messages/lv.json";

// en.json is a full translation (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §4.2):
// the same keys as lv.json, except the admin, which stays in Latvian. A key
// added to lv.json without English fails here, so no page shows a Latvian
// line on /en by accident.

type Tree = { [k: string]: unknown };

function keys(o: unknown, prefix = ""): string[] {
  if (!o || typeof o !== "object" || Array.isArray(o)) return [prefix];
  return Object.entries(o as Tree).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

/** Argument names, not the words inside plural or select branches ("=1 {one}"). */
function placeholders(s: string): string[] {
  return [...s.matchAll(/(?<![\s},](?:=\d+|zero|one|two|few|many|other|f|m)\s?)\{(\w+)[,}]/g)].map(
    (m) => m[1]!,
  );
}

describe("en.json", () => {
  const lvPublic = Object.fromEntries(Object.entries(lv).filter(([k]) => k !== "admin"));
  const lvKeys = new Set(keys(lvPublic));
  const enKeys = new Set(keys(en));

  it("has every key lv.json has, and no others", () => {
    expect([...lvKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !lvKeys.has(k))).toEqual([]);
  });

  // English may drop a Latvian-only argument (the grammatical gender of a
  // category), but must not use one the page does not pass.
  it("uses only placeholders the Latvian message has", () => {
    const get = (o: unknown, path: string) =>
      path.split(".").reduce<unknown>((x, k) => (x as Tree | undefined)?.[k], o);
    const wrong = [...lvKeys].filter((k) => {
      const a = get(lvPublic, k);
      const b = get(en, k);
      if (typeof a !== "string" || typeof b !== "string") return false;
      const known = new Set(placeholders(a));
      return placeholders(b).some((p) => !known.has(p));
    });
    expect(wrong).toEqual([]);
  });

  it("has a legal summary in both languages wherever one exists", () => {
    for (const doc of ["privacy", "terms", "purchase"] as const) {
      expect(lv.legal[doc].summary.length).toBe(en.legal[doc].summary.length);
    }
  });
});
