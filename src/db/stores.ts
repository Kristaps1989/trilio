// Store configuration (CLAUDE.md rule 7: shop names are configuration, not
// code). The seed upserts these rows; production edits them in the database.
// Feed URLs and affiliate templates are filled in when each partner provides
// them; until then the store is inactive and nothing is shown for it.
//
// Shops without a feed are read from their public product pages
// (feedType "scrape", docs/SCRAPING.md): euronics.lv, m79.lv and tet.lv.
// Their sitemap lists and category maps were measured on the live sites in
// October 2026.

/** Turns a decoded category label into the form it has in a URL path ("a b" → "a\\+b"). */
function urlSegment(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\+");
}

const EURONICS_CATEGORY_MAP: Record<string, string> = {
  "sadzives-tehnika/ledusskapji/ledusskapji": "fridge",
  "sadzives-tehnika/ledusskapji/iebuvejamie-ledusskapji": "fridge",
  "sadzives-tehnika/ledusskapji/saldetavas": "freezer",
  "sadzives-tehnika/velas-mazgajamas-un-zavejamas-masinas/velas-masinas-ar-prieksejo-ieladi": "washer",
  "sadzives-tehnika/velas-mazgajamas-un-zavejamas-masinas/velas-mazgajamas-zavejamas-masinas-divi-viena":
    "washer",
  "sadzives-tehnika/velas-mazgajamas-un-zavejamas-masinas/velas-zavejamas-masinas": "dryer",
  "maza-sadzives-tehnika/gludinasana/gludekli": "iron",
  "maza-sadzives-tehnika/gludinasana/gludinasanas-sistemas": "iron",
  "maza-sadzives-tehnika/gludinasana/tvaika-sistemas": "steamer",
  "sadzives-tehnika/trauku-mazgajamas-masinas/brivi-stavosas-trauku-mazgajamas-masinas": "dish",
  "sadzives-tehnika/trauku-mazgajamas-masinas/galda-trauku-mazgajamas-masinas": "dish",
  "sadzives-tehnika/trauku-mazgajamas-masinas/iebuvejamas-trauku-mazgajamas-masinas": "dish",
  "sadzives-tehnika/plitis-un-cepeskrasnis/plits-virsmas": "hob",
  "sadzives-tehnika/plitis-un-cepeskrasnis/brivi-stavosas-plitis": "hob",
  "sadzives-tehnika/plitis-un-cepeskrasnis/iebuvejamas-cepeskrasnis": "oven",
  "sadzives-tehnika/tvaika-nosuceji/iebuvejamie-tvaika-nosuceji": "hood",
  "sadzives-tehnika/iebuvejama-tehnika/iebuvejamie-tvaika-nosuceji": "hood",
  "sadzives-tehnika/plitis-un-cepeskrasnis/mikrovilnu-krasnis": "micro",
  "maza-sadzives-tehnika/puteklu-suceji/bezvadu-puteklu-suceji": "vacuum",
  "maza-sadzives-tehnika/puteklu-suceji/puteklu-suceji-ar-puteklu-maisiniem": "vacuum",
  "maza-sadzives-tehnika/puteklu-suceji/puteklu-suceji-bez-puteklu-maisina": "vacuum",
  "maza-sadzives-tehnika/puteklu-suceji/roboti-puteklu-suceji": "vacuum",
  "maza-sadzives-tehnika/puteklu-suceji/rokas-puteklu-suceji": "vacuum",
  "maza-sadzives-tehnika/mitra-uzkopsana/mazgajosie-bezvadu-puteklu-suceji": "vacuum",
  "maza-sadzives-tehnika/mitra-uzkopsana/mazgajosie-puteklu-suceji": "vacuum",
  "maza-sadzives-tehnika/mitra-uzkopsana/tvaika-tiritaji": "steamclean",
  "virtuves-tehnika/kafijas-automati/kafijas-automati": "coffee",
  "virtuves-tehnika/kafijas-automati/kafijas-automati-ar-filtru": "coffee",
  "virtuves-tehnika/kafijas-automati/kafijas-automati-ar-kapsulam-un-maisiniem": "coffee",
  "virtuves-tehnika/kafijas-automati/kafijas-dzirnavinas": "grinder",
  "virtuves-tehnika/virtuves-tehnika/tejkannas": "kettle",
  "virtuves-tehnika/veseligam-dzivesveidam/blenderi": "blender",
  "virtuves-tehnika/partikas-apstrade/rokas-blenderi": "handblender",
  "virtuves-tehnika/partikas-apstrade/virtuves-kombaini": "foodproc",
  "virtuves-tehnika/partikas-apstrade/mikseri": "mixer",
  "virtuves-tehnika/partikas-apstrade/smalcinataji": "chopper",
  "virtuves-tehnika/partikas-apstrade/galas-malamas-masinas": "mincer",
  "virtuves-tehnika/ediena-pagatavosana/grili": "grill",
  "virtuves-tehnika/virtuves-tehnika/tosteri": "toaster",
  "virtuves-tehnika/virtuves-tehnika/kontakttosteri": "sandwich",
  "virtuves-tehnika/ediena-pagatavosana/friteri-un-aerogrili": "airfryer",
  "virtuves-tehnika/ediena-pagatavosana/maizes-krasninas": "breadmaker",
  "virtuves-tehnika/veseligam-dzivesveidam/sulu-spiedes": "juicer",
  "virtuves-tehnika/veseligam-dzivesveidam/auglu-un-darzenu-zavetaji": "dehydrator",
  "virtuves-tehnika/veseligam-dzivesveidam/vakuuma-iepakotaji": "vacuumsealer",
};

/** euronics.lv product sitemaps (?type=Product&cat=…) that contain the categories above. */
const EURONICS_SITEMAP_CATS = [
  "1394",
  "1399",
  "1401",
  "1403",
  "1404",
  "1405",
  "1406",
  "1407",
  "1409",
  "1410",
  "1412",
  "1427",
  "1428",
  "1429",
  "1431",
  "1432",
  "1433",
  "1434",
  "1435",
  "1436",
  "1437",
  "1438",
  "1440",
  "1441",
  "2124",
  "2127",
  "2574",
  "2578",
  "2585",
  "2593",
  "3044",
  "3047",
  "3054",
  "3062",
  "3067",
  "3333",
  "3343",
  "3347",
  "3350",
  "3388",
  "3393",
  "3396",
  "3400",
  "3410",
  "3413",
  "3416",
  "3421",
  "3707",
];

const M79_CATEGORY_MAP: Record<string, string> = {
  ledusskapji: "fridge",
  "kombinetie ledusskapji": "fridge",
  "side by side ledusskapji": "fridge",
  saldetavas: "freezer",
  velasmasinas: "washer",
  "velas zavetaji": "dryer",
  gludekli: "iron",
  "tvaika gludekli": "iron",
  "stacijas gludinasanai ar tvaiku": "iron",
  "trauku mazgajamas masinas": "dish",
  cepeskrasnis: "oven",
  "tvaika nosuceji": "hood",
  "mikrovilnu krasnis": "micro",
  puteklusuceji: "vacuum",
  "roboti-puteklsuceji": "vacuum",
  "rokas turamie puteklsuceji": "vacuum",
  "mazgabarita puteklu suceji un elektriskas slotas": "vacuum",
  "tvaika tirisanas ierices": "steamclean",
  "kafijas automati": "coffee",
  "kafijas dzirnavinas": "grinder",
  "elektriskas tejkannas": "kettle",
  blenderi: "blender",
  "smutiju blenderi": "blender",
  "virtuves kombaini": "foodproc",
  mikseri: "mixer",
  "elektriskie mikseri": "mixer",
  "galas malamas masinas": "mincer",
  "virtuves svari": "scale",
  "elektriskie nazi": "knife",
  "elektriskie grili": "grill",
  "kontakta grili": "grill",
  tosteri: "toaster",
  "sviestmaizu grili": "sandwich",
  "aerogrili, karsta gaisa friteri, taukvares katli": "airfryer",
  "maizes cepjamas masinas": "breadmaker",
  "sulu spiedes": "juicer",
  "elektriskas citrusauglu sulu spiedes": "juicer",
  "vakuuma aparati": "vacuumsealer",
};

/** tet.lv shop URLs are /veikals/<category>/<product>.html. */
const TET_CATEGORY_MAP: Record<string, string> = {
  ledusskapji: "fridge",
  "ledusskapji-2": "fridge",
  saldetavas: "freezer",
  "velas-masinas": "washer",
  "velas-zavetaji": "dryer",
  gludekli: "iron",
  "tvaika-gludekli": "iron",
  "tvaika-gludinasanas-sistemas": "iron",
  "trauku-mazgajamas-masinas": "dish",
  "trauku-mazgajamas-masinas-2": "dish",
  "plits-virsmas": "hob",
  plitis: "hob",
  cepeskrasnis: "oven",
  "tvaika-nosuceji": "hood",
  "tvaika-nosuceji-2": "hood",
  "mikrovilnu-krasnis": "micro",
  "mikrovilnu-krasnis-2": "micro",
  "puteklu-suceji": "vacuum",
  "roboti-puteklu-suceji": "vacuum",
  "tvaika-tiritaji": "steamclean",
  "kafijas-automati": "coffee",
  "kafijas-dzirnavinas": "grinder",
  tejkannas: "kettle",
  blenderi: "blender",
  "virtuves-kombaini": "foodproc",
  mikseri: "mixer",
  "galas-malamas-masinas": "mincer",
  "virtuves-svari": "scale",
  grili: "grill",
  tosteri: "toaster",
  "sviestmaizu-tosteri": "sandwich",
  friteri: "airfryer",
  "maizes-krasnis": "breadmaker",
  "mazas-cepeskrasnis": "minioven",
  "sulu-spiedes": "juicer",
  "auglu-zavetaji": "dehydrator",
  "vakuuma-iepakotaji": "vacuumsealer",
};

export type StoreSeed = {
  slug: string;
  displayName: string;
  feedType: "sample" | "google_xml" | "csv" | "api" | "scrape";
  feedUrl?: string;
  affiliateTemplateUrl?: string;
  imageHosts?: string[];
  categoryMap?: Record<string, string>;
  /** For feedType "scrape"; validated by ScrapeConfigSchema at run time. */
  scrapeConfig?: Record<string, unknown>;
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

/**
 * Partner shops for the Latvian launch. 1a.lv and rdveikals.lv answer
 * crawlers with a Cloudflare bot challenge and neoshop.lv with a JavaScript
 * cookie challenge; discover.lv has no sitemap or structured data. Those
 * stay inactive until the shop sends a feed or allow-lists our crawler: we
 * do not work around a shop's bot protection (docs/SCRAPING.md).
 */
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
    feedType: "scrape",
    imageHosts: ["euronics.lv", "*.euronics.lv"],
    categoryMap: EURONICS_CATEGORY_MAP,
    scrapeConfig: {
      sitemaps: EURONICS_SITEMAP_CATS.map((c) => `https://www.euronics.lv/sitemap.xml?type=Product&cat=${c}`),
      // Latvian pages only (/en/ and /ru/ duplicates are skipped).
      include: [`^/(${Object.keys(EURONICS_CATEGORY_MAP).map(urlSegment).join("|")})/`],
      categoryFromUrl: "^/((?:sadzives-tehnika|maza-sadzives-tehnika|virtuves-tehnika)/[^/]+/[^/]+)/",
      // About 2 100 pages: a full pass in under an hour, so every run is complete.
      maxPages: 3000,
      delayMs: 1500,
      maxRunMinutes: 100,
    },
    active: true,
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
    feedType: "scrape",
    imageHosts: ["m79.lv", "*.m79.lv"],
    categoryMap: M79_CATEGORY_MAP,
    scrapeConfig: {
      sitemaps: ["https://www.m79.lv/sitemap.xml"],
      include: [`^/p/products/\\d+/(${Object.keys(M79_CATEGORY_MAP).map(urlSegment).join("|")})/`],
      categoryFromUrl: "^/p/products/\\d+/([^/]+)/",
      // About 35 000 appliance pages: each run reads 2 000 (never-seen and oldest first).
      // Six runs a day complete a rotation in about three days, inside staleAfterHours.
      maxPages: 2000,
      delayMs: 1500,
      maxRunMinutes: 90,
      staleAfterHours: 168,
    },
    active: true,
  },
  {
    slug: "tet",
    displayName: "Tet",
    feedType: "scrape",
    imageHosts: ["cdn.tet.lv"],
    categoryMap: TET_CATEGORY_MAP,
    scrapeConfig: {
      sitemaps: ["https://www.tet.lv/veikals/sitemap.default.xml"],
      include: [`^/veikals/(${Object.keys(TET_CATEGORY_MAP).map(urlSegment).join("|")})/[^/]+\\.html$`],
      categoryFromUrl: "^/veikals/([^/]+)/[^/]+\\.html$",
      // About 2 500 pages: a full pass in a little over an hour. EAN comes from data-ean.
      maxPages: 3000,
      delayMs: 1500,
      maxRunMinutes: 100,
    },
    active: true,
  },
  {
    // Full schema.org data with EAN on product pages, but no usable sitemap and
    // listings load from a private API. Waits for a product feed (docs/SCRAPING.md).
    slug: "bigbox",
    displayName: "BIGBOX",
    feedType: "google_xml",
    imageHosts: ["media-api.bgbx.eu"],
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
