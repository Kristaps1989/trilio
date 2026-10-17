import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Phase 1 tables from docs/DATA_MODEL.md. Money is integer cents. Shop names
// live in `stores` (rule 7: shop names are configuration, not code).

export const feedTypeEnum = pgEnum("feed_type", ["sample", "google_xml", "csv", "api"]);
export const conditionEnum = pgEnum("condition", ["new", "refurbished"]);
export const stockEnum = pgEnum("stock", ["in", "soon", "out"]);

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  country: text("country").notNull().default("LV"),
  /** `{url}` is replaced with the offer URL; `{ean}` with the EAN. Built server-side only. */
  affiliateTemplateUrl: text("affiliate_template_url"),
  feedType: feedTypeEnum("feed_type").notNull().default("sample"),
  feedUrl: text("feed_url"),
  /** Hostnames the feed fetcher may follow redirects to; the feed URL's host is always allowed. */
  feedAllowedHosts: text("feed_allowed_hosts")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Image hosts for next/image remotePatterns. */
  imageHosts: text("image_hosts")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  defaultDeliveryDays: integer("default_delivery_days").notNull().default(3),
  active: boolean("active").notNull().default(true),
  lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** GTIN-13/14, normalised; null only when a feed has none and the brand+model key is used. */
    ean: text("ean").unique(),
    brand: text("brand").notNull(),
    modelCode: text("model_code").notNull(),
    /** brand + normalised model code; the fallback identity when EAN is missing. */
    modelKey: text("model_key").notNull(),
    name: text("name").notNull(),
    subcategoryId: text("subcategory_id").notNull(),
    /** Shape-independent attributes: w, h, d, volume_l, energy_class, noise_db, no_frost, freezer, run_min, mop, pet … */
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    /** Option values from the question schema this product satisfies (soft-answer matching). */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Spec line shown on the card. */
    specs: text("specs"),
    kwhYear: integer("kwh_year"),
    eprelId: text("eprel_id"),
    /** Trilio rating 0–100 (8,6/10 is stored as 86). Inputs are decided by the owner; see ROADMAP. */
    rating: integer("rating"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_model_key_idx").on(t.modelKey),
    index("products_subcategory_idx").on(t.subcategoryId),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** The store's own id for the offer; with store_id it is the upsert key. */
    externalId: text("external_id").notNull(),
    condition: conditionEnum("condition").notNull().default("new"),
    /** Refurbished only: e.g. "A — sīki skrāpējumi sānu panelī". */
    grade: text("grade"),
    warrantyMonths: integer("warranty_months"),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    stock: stockEnum("stock").notNull(),
    /** Shop's own ETA in working days when the feed has one; otherwise the store default applies. */
    deliveryEtaDays: integer("delivery_eta_days"),
    url: text("url").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("offers_store_external_idx").on(t.storeId, t.externalId),
    index("offers_product_idx").on(t.productId),
  ],
);

/** One row per offer per ingestion run. Powers the 30-day low (Omnibus) and radar sparklines. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    stock: stockEnum("stock").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_snapshots_offer_time_idx").on(t.offerId, t.capturedAt)],
);

export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  rowsRead: integer("rows_read").notNull().default(0),
  rowsUpserted: integer("rows_upserted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  error: text("error"),
});

/** Saved answers; also anonymised demand data. user_id arrives in Phase 2. */
export const searchSessions = pgTable("search_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  subcategoryId: text("subcategory_id").notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
  budgetCents: integer("budget_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const waitlistLeads = pgTable("waitlist_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  freeText: text("free_text"),
  detectedSubcategoryId: text("detected_subcategory_id"),
  source: text("source").notNull().default("free_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const affiliateClicks = pgTable(
  "affiliate_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    searchSessionId: uuid("search_session_id").references(() => searchSessions.id, { onDelete: "set null" }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("affiliate_clicks_offer_idx").on(t.offerId)],
);

export type Store = typeof stores.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type NewOffer = typeof offers.$inferInsert;
