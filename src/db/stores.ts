// Store configuration (CLAUDE.md rule 7: shop names are configuration, not
// code). The seed upserts these rows; production edits them in the database.
// Feed URLs and affiliate templates are filled in when each partner provides
// them; until then the store is inactive and nothing is shown for it.

export type StoreSeed = {
  slug: string;
  displayName: string;
  feedType: "sample" | "google_xml" | "csv" | "api";
  feedUrl?: string;
  affiliateTemplateUrl?: string;
  imageHosts?: string[];
  categoryMap?: Record<string, string>;
  defaultDeliveryDays?: number;
  active: boolean;
};

/** Placeholder stores used by data/sample-products.json. Inactive once a real feed exists. */
export const SAMPLE_STORES: StoreSeed[] = ["a", "b", "c", "d", "e"].map((s) => ({
  slug: `store_${s}`,
  displayName: `Veikals ${s.toUpperCase()}`,
  feedType: "sample",
  defaultDeliveryDays: 3,
  active: true,
}));

/** Partner shops for the Latvian launch. */
export const PARTNER_STORES: StoreSeed[] = [
  {
    slug: "1a",
    displayName: "1a.lv",
    feedType: "google_xml",
    imageHosts: ["1a.lv", "*.1a.lv"],
    active: false,
  },
  {
    slug: "euronics",
    displayName: "Euronics",
    feedType: "google_xml",
    imageHosts: ["euronics.lv", "*.euronics.lv"],
    active: false,
  },
  {
    slug: "rdveikals",
    displayName: "RD Electronics",
    feedType: "google_xml",
    imageHosts: ["rdveikals.lv", "*.rdveikals.lv"],
    active: false,
  },
  {
    slug: "neoshop",
    displayName: "Neoshop",
    feedType: "google_xml",
    imageHosts: ["neoshop.lv", "*.neoshop.lv"],
    active: false,
  },
  {
    slug: "m79",
    displayName: "M79",
    feedType: "google_xml",
    imageHosts: ["m79.lv", "*.m79.lv"],
    active: false,
  },
  {
    slug: "discover",
    displayName: "Discover",
    feedType: "google_xml",
    imageHosts: ["discover.lv", "*.discover.lv"],
    active: false,
  },
];
