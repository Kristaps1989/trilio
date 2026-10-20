import { describe, expect, it } from "vitest";
import attributes from "../../data/attributes.json";
import lv from "./messages/lv.json";

// Every attribute a subcategory compares has a Latvian label, and every
// boolean one a phrase for the upgrade line ("Par +X € vairāk … tu iegūsti"),
// so a new category never shows a raw key or throws MISSING_MESSAGE.

type Catalog = {
  attributes: Record<string, { type: string }>;
  subcategories: Record<string, { key: string[] }>;
};
const catalog = attributes as unknown as Catalog;
const attr = lv.attr as Record<string, string>;
const feature = lv.delta.feature as Record<string, string>;

describe("attribute labels", () => {
  for (const [sub, { key }] of Object.entries(catalog.subcategories)) {
    it(`${sub}: every compared attribute has a label`, () => {
      expect(key.filter((k) => !attr[k])).toEqual([]);
      const booleans = key.filter((k) => catalog.attributes[k]?.type === "boolean");
      expect(booleans.filter((k) => !feature[k])).toEqual([]);
    });
  }
});
