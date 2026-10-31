import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// Phase 1 tables from docs/DATA_MODEL.md. Money is integer cents. Shop names
// live in `stores` (rule 7: shop names are configuration, not code).

export const feedTypeEnum = pgEnum("feed_type", ["sample", "google_xml", "csv", "api", "scrape"]);
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
  /** Feed category label → subcategory id (see services/ingestion/common.ts mapCategory). */
  categoryMap: jsonb("category_map").$type<Record<string, string>>().notNull().default({}),
  /** For feed_type 'scrape': sitemaps, URL patterns and pacing (services/ingestion/scrape/crawler.ts). */
  scrapeConfig: jsonb("scrape_config").$type<Record<string, unknown>>(),
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
    /** Typed attributes (data/attributes.json): height_cm, volume_l, energy_class, form … */
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    /** Where each attribute came from: eprel, spec_table, feed, same_ean, rule, claude, claude_web. */
    attributeSources: jsonb("attribute_sources").$type<Record<string, string>>().notNull().default({}),
    /** The shop spec table as last read (label → value); re-normalised when the catalogue changes. */
    specTable: jsonb("spec_table").$type<Record<string, string>>(),
    /**
     * Every shop's category label for the product ("roboti-puteklu-suceji"). Ingestion
     * normalises with it, so re-normalising must too, or "robot" from a shop's
     * category is lost and a robot vacuum becomes a stick.
     */
    shopCategories: text("shop_categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Option values from the question schema this product satisfies (soft-answer matching). */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Spec line shown on the card. */
    specs: text("specs"),
    /** Raw description from the feed; input for LLM attribute extraction, never shown as-is. */
    description: text("description"),
    /** Set when attributes/tags were filled by the extraction job; null = not yet extracted. */
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    /** 0–100 self-reported confidence of the extraction; low values are shown as "nav apstiprināts". */
    extractionConfidence: integer("extraction_confidence"),
    extractionModel: text("extraction_model"),
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
    /** The shop's own review score (schema.org aggregateRating), in tenths of a star: 46 = 4,6 ★. */
    ratingX10: integer("rating_x10"),
    /** How many reviews the shop's score is based on. */
    ratingCount: integer("rating_count"),
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

/**
 * "Vai šie trīs deva pārliecību izvēlēties?" (docs/CONFIDENCE_PLAN.md §3 E):
 * one anonymous answer per results view. No identity, no e-mail.
 */
export const confidenceAnswers = pgTable(
  "confidence_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    searchSessionId: uuid("search_session_id").references(() => searchSessions.id, { onDelete: "set null" }),
    subcategoryId: text("subcategory_id").notNull(),
    confident: boolean("confident").notNull(),
    /** "Kā?" — what was missing, at most 300 characters. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("confidence_answers_created_idx").on(t.createdAt)],
);

export const affiliateClicks = pgTable(
  "affiliate_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    searchSessionId: uuid("search_session_id").references(() => searchSessions.id, { onDelete: "set null" }),
    /** The ad visit that brought this visitor today, if any (docs/GROWTH_PLAN.md, Phase 0). */
    adLandingId: uuid("ad_landing_id").references((): AnyPgColumn => adLandings.id, { onDelete: "set null" }),
    /** The day's anonymous visitor hash, to count one click per visitor and product per 30 minutes. */
    visitorHash: text("visitor_hash"),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("affiliate_clicks_offer_idx").on(t.offerId),
    index("affiliate_clicks_visitor_idx").on(t.visitorHash, t.offerId),
    index("affiliate_clicks_ad_idx").on(t.adLandingId),
  ],
);

export type Store = typeof stores.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type NewOffer = typeof offers.$inferInsert;

/** Every Claude API call: purpose, tokens and outcome. No prompt text and no user text are stored. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    ok: boolean("ok").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_purpose_time_idx").on(t.purpose, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Phase 2: accounts, subscriptions (Paysera recurring billing), price radar.
// ---------------------------------------------------------------------------

/** Auth.js tables (Drizzle adapter). Only the columns the adapter needs plus locale. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  locale: text("locale").notNull().default("lv"),
  /** Consent to personal offers by e-mail (docs/ADMIN_AND_OFFERS_PLAN.md §2.3); unticked by default. */
  offersOptIn: boolean("offers_opt_in").notNull().default(false),
  offersOptInAt: timestamp("offers_opt_in_at", { withTimezone: true }),
  /** One-click unsubscribe token for offer e-mails; set when the first offer is sent. */
  offersToken: text("offers_token").unique(),
  /** When the one-time offers question was shown under a heart (docs/TRUST_POLISH_PLAN.md §1). */
  offersAskedAt: timestamp("offers_asked_at", { withTimezone: true }),
  /**
   * Price-drop e-mails about saved items: free and on by default, because
   * saving is the request (owner, 24 Oct 2026); off with one tap or one click.
   */
  priceAlerts: boolean("price_alerts").notNull().default(true),
  /** One-click unsubscribe token for price-drop e-mails; set with the first e-mail. */
  alertsToken: text("alerts_token").unique(),
  /** The admin's private notes about this customer (shown in the GDPR export). */
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const planIntervalEnum = pgEnum("plan_interval", ["month", "year"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "pending",
  "active",
  "past_due",
  "canceled",
  "expired",
]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "captured", "failed", "canceled"]);
/** initial and renewal: the e-mail service; order: a personal offer bought from Trilio. */
export const paymentKindEnum = pgEnum("payment_kind", ["initial", "renewal", "order"]);
export const paymentProviderEnum = pgEnum("payment_provider", ["paysera", "mock"]);

/** Subscription plans are configuration rows: 1,99 €/month and 12 €/year at launch. */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("EUR"),
  interval: planIntervalEnum("interval").notNull(),
  active: boolean("active").notNull().default(true),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum("status").notNull().default("pending"),
    provider: paymentProviderEnum("provider").notNull(),
    /** Recurring billing token, AES-256-GCM encrypted at rest (services/crypto.ts). Never sent to the client. */
    tokenEncrypted: text("token_encrypted"),
    /** Card label for the radar page ("Karte •••• 4242"), from the provider's payer/card info when given. */
    paymentMethodLabel: text("payment_method_label"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    nextBillingAt: timestamp("next_billing_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    /** Prepaid periods (no token): when the "your radar ends soon" e-mail went out for the current period. */
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_user_idx").on(t.userId),
    index("subscriptions_billing_idx").on(t.status, t.nextBillingAt),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Set for the e-mail service; null for an order payment. */
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "cascade" }),
    /** Set for an order payment (personal offers). */
    offerOrderId: uuid("offer_order_id").references((): AnyPgColumn => offerOrders.id, {
      onDelete: "set null",
    }),
    /** Our unique order reference sent to the provider; idempotency key for callbacks. */
    orderId: text("order_id").notNull().unique(),
    providerRequestId: text("provider_request_id"),
    kind: paymentKindEnum("kind").notNull(),
    /** The plan this payment buys; a prepaid extension may switch plans (null on rows from before it existed). */
    planId: text("plan_id").references(() => plans.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_subscription_idx").on(t.subscriptionId)],
);

/** Every provider notification processed once (callbacks are retried until marked read). */
export const paymentNotifications = pgTable(
  "payment_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: paymentProviderEnum("provider").notNull(),
    notificationId: text("notification_id").notNull(),
    event: text("event"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_notifications_provider_id_idx").on(t.provider, t.notificationId)],
);

export const radarThresholdEnum = pgEnum("radar_threshold", ["any", "5", "10"]);
export const radarScopeEnum = pgEnum("radar_scope", ["only", "brand", "any"]);

export const radars = pgTable(
  "radars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    searchSessionId: uuid("search_session_id").references(() => searchSessions.id, { onDelete: "set null" }),
    threshold: radarThresholdEnum("threshold").notNull().default("any"),
    scope: radarScopeEnum("scope").notNull().default("only"),
    /** Empty = all active stores. */
    storeIds: uuid("store_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    includeRefurbished: boolean("include_refurbished").notNull().default(false),
    channels: text("channels")
      .array()
      .notNull()
      .default(sql`'{email}'::text[]`),
    paused: boolean("paused").notNull().default(false),
    /** Price the next drop is measured against: at creation, then the last notified price. */
    baselinePriceCents: integer("baseline_price_cents"),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    /** Soft delete with undo (spec §5.2); purged after a day. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("radars_user_idx").on(t.userId), index("radars_product_idx").on(t.productId)],
);

export const radarEvents = pgTable(
  "radar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radarId: uuid("radar_id")
      .notNull()
      .references(() => radars.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").references(() => offers.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    kind: text("kind").$type<"drop" | "similar">().notNull(),
    oldPriceCents: integer("old_price_cents"),
    newPriceCents: integer("new_price_cents").notNull(),
    channels: text("channels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("radar_events_radar_time_idx").on(t.radarId, t.sentAt)],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Wishlist ("Vēlmju saraksts", owner 20 Oct 2026; replaces the radar UI):
// a heart saves a product or a whole search (subcategory + answers). The
// list is free; the paid service e-mails a daily digest of price drops.
export const savedItemKindEnum = pgEnum("saved_item_kind", ["product", "search"]);

export const savedItems = pgTable(
  "saved_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: savedItemKindEnum("kind").notNull(),
    /** "p:<productId>" or "s:<subcategory>:<answers>": one save per thing per user. */
    key: text("key").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    subcategoryId: text("subcategory_id").notNull(),
    /** Search only: the flow's URL encoding of the answers, so the search reopens as saved. */
    answersParam: text("answers_param"),
    /** Search only: what was asked, e.g. "Ledusskapji · 181–205 cm · Divas durvis". */
    label: text("label"),
    /** Price a drop is measured against: at saving, then the last notified price. */
    baselinePriceCents: integer("baseline_price_cents"),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    /** The ad visit that brought the saver today, if any (docs/GROWTH_PLAN.md, Phase 0). */
    adLandingId: uuid("ad_landing_id").references((): AnyPgColumn => adLandings.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saved_items_user_key_idx").on(t.userId, t.key),
    index("saved_items_user_idx").on(t.userId),
  ],
);

/** Per-user setting for the paid e-mail digest: which drops count. */
export const notifySettings = pgTable("notify_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  threshold: radarThresholdEnum("threshold").notNull().default("5"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One EPREL lookup per product (docs/ATTRIBUTES.md): what was found, so the
 * job asks again only when a product is new or its lookup is old.
 */
export const eprelLookups = pgTable("eprel_lookups", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  /** found, not_found (no published record for this EAN or model), or error (try again soon). */
  status: text("status").notNull(),
  /** How it was found: by EAN (free endpoint) or by brand and model (needs EPREL_API_KEY). */
  method: text("method"),
  productGroup: text("product_group"),
  registrationNumber: text("registration_number"),
  /** The EPREL record as received, for audit and later mappings. */
  record: jsonb("record").$type<Record<string, unknown>>(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SavedItem = typeof savedItems.$inferSelect;
export type Radar = typeof radars.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Plan = typeof plans.$inferSelect;

// ---------------------------------------------------------------------------
// Admin section, visit counting and personal offers (docs/ADMIN_AND_OFFERS_PLAN.md).

/**
 * First-party page views without cookies: the visitor is a hash of a daily
 * random salt, the IP and the user agent, so nobody can be followed across
 * days. Raw rows are purged after 35 days; `visit_daily` keeps the counts.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull(),
    path: text("path").notNull(),
    section: text("section").notNull(),
    subcategory: text("subcategory"),
    visitorHash: text("visitor_hash").notNull(),
    /** Browser family and system ("Chrome Android"), never the full user agent. */
    client: text("client"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visits_day_idx").on(t.day)],
);

/** Requests recognised as bots and left out of the statistics, per day and kind. */
export const botHits = pgTable(
  "bot_hits",
  {
    day: date("day").notNull(),
    /** "visit", "search" or "click". */
    kind: text("kind").notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.kind] })],
);

/** Today's and yesterday's salt; older ones are deleted, which makes old hashes unlinkable. */
export const visitSalts = pgTable("visit_salts", {
  day: date("day").primaryKey(),
  salt: text("salt").notNull(),
});

export const visitDaily = pgTable(
  "visit_daily",
  {
    day: date("day").notNull(),
    path: text("path").notNull(),
    section: text("section").notNull(),
    subcategory: text("subcategory"),
    views: integer("views").notNull(),
    visitors: integer("visitors").notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.path] })],
);

/** Every admin write: who, what, which record, when, from where. */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt)],
);

/** Switches the admin flips at runtime (e.g. pausing all offer e-mails). */
export const appFlags = pgTable("app_flags", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const offerStatusEnum = pgEnum("offer_status", [
  "draft",
  "sent",
  "opened",
  "accepted",
  "paid",
  "expired",
  "cancelled",
]);

/** One personal offer to one person for one product. */
export const specialOffers = pgTable(
  "special_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The public link /piedavajums/{token}: 32 random bytes, base64url. */
    token: text("token").notNull().unique(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** Snapshot, so the offer still reads right if the catalogue changes. */
    productName: text("product_name").notNull(),
    subcategoryId: text("subcategory_id").notNull(),
    condition: conditionEnum("condition").notNull().default("new"),
    grade: text("grade"),
    warrantyMonths: integer("warranty_months").notNull().default(24),
    priceCents: integer("price_cents").notNull(),
    /** The monitored best price, its shop and the 30-day low when the offer was made (frozen claims). */
    referencePriceCents: integer("reference_price_cents"),
    referenceLow30Cents: integer("reference_low30_cents"),
    referenceStoreName: text("reference_store_name"),
    quantity: integer("quantity").notNull().default(1),
    deliveryWorkingDays: integer("delivery_working_days").notNull().default(3),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    message: text("message"),
    /** Admin-only: distributor and purchase price. Never shown to the shopper or exported to them. */
    supplierNote: text("supplier_note"),
    costCents: integer("cost_cents"),
    status: offerStatusEnum("status").notNull().default("draft"),
    /** Offers created together ("Piedāvāt visiem") share a batch. */
    batchId: uuid("batch_id"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [index("special_offers_user_idx").on(t.userId), index("special_offers_status_idx").on(t.status)],
);

export const orderStatusEnum = pgEnum("order_status", [
  "awaiting_payment",
  "paid",
  "packed",
  "shipped",
  "delivered",
  "return_requested",
  "returned",
  "refunded",
  "cancelled",
]);
export const buyerKindEnum = pgEnum("buyer_kind", ["person", "company"]);
export const deliveryMethodEnum = pgEnum("delivery_method", ["courier", "locker"]);

/** An accepted offer: who buys, where it goes, payment and delivery state. One per offer. */
export const offerOrders = pgTable(
  "offer_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .unique()
      .references(() => specialOffers.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Shown to the buyer and on the payment: "T-1042". */
    number: text("number").notNull().unique(),
    status: orderStatusEnum("status").notNull().default("awaiting_payment"),
    amountCents: integer("amount_cents").notNull(),
    buyerKind: buyerKindEnum("buyer_kind").notNull().default("person"),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email").notNull(),
    street: text("street"),
    city: text("city"),
    postcode: text("postcode"),
    country: text("country").notNull().default("LV"),
    deliveryMethod: deliveryMethodEnum("delivery_method").notNull().default("courier"),
    lockerId: text("locker_id"),
    lockerName: text("locker_name"),
    carryIn: boolean("carry_in").notNull().default(false),
    deliveryNote: text("delivery_note"),
    companyName: text("company_name"),
    companyRegNo: text("company_reg_no"),
    companyVatNo: text("company_vat_no"),
    legalAddress: text("legal_address"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** carrier, admin or buyer. */
    deliveryConfirmedBy: text("delivery_confirmed_by"),
    lastTrackedAt: timestamp("last_tracked_at", { withTimezone: true }),
    returnRequestedAt: timestamp("return_requested_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundReference: text("refund_reference"),
    /** "Viss kārtībā?" seven days after delivery: a link that needs no sign-in. */
    feedbackToken: text("feedback_token").notNull().unique(),
    feedbackAskedAt: timestamp("feedback_asked_at", { withTimezone: true }),
    feedback: text("feedback"),
    feedbackNote: text("feedback_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offer_orders_status_idx").on(t.status), index("offer_orders_user_idx").on(t.userId)],
);

/** The timeline both sides see, plus sign-ins through offer links. */
export const offerEvents = pgTable(
  "offer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => specialOffers.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => offerOrders.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** admin, buyer, system or carrier. */
    source: text("source").notNull(),
    note: text("note"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offer_events_offer_idx").on(t.offerId)],
);

export const invoiceKindEnum = pgEnum("invoice_kind", ["invoice", "credit_note"]);

/**
 * Trilio's sales ledger. Seller and buyer are snapshots: invoices must be kept
 * unchanged for accounting, also after the buyer deletes the account.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: invoiceKindEnum("kind").notNull().default("invoice"),
    /** "TR-2026-0001"; credit notes share the series. */
    number: text("number").notNull().unique(),
    year: integer("year").notNull(),
    seq: integer("seq").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => offerOrders.id, { onDelete: "restrict" }),
    /** For a credit note: the invoice it reverses. */
    creditForId: uuid("credit_for_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    seller: jsonb("seller").$type<Record<string, string>>().notNull(),
    buyer: jsonb("buyer").$type<Record<string, string>>().notNull(),
    lines: jsonb("lines").$type<{ text: string; quantity: number; totalCents: number }[]>().notNull(),
    netCents: integer("net_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** 21 when Trilio is VAT-registered at issue time; null: "PVN nav piemērojams". */
    vatRate: integer("vat_rate"),
  },
  (t) => [uniqueIndex("invoices_year_seq_idx").on(t.year, t.seq)],
);

export type SpecialOffer = typeof specialOffers.$inferSelect;
export type OfferOrder = typeof offerOrders.$inferSelect;
export type OfferEvent = typeof offerEvents.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;

// ---------------------------------------------------------------- growth (docs/GROWTH_PLAN.md)

/**
 * A visit that arrived from an ad: the click id and campaign tags with that
 * day's cookieless visitor hash, so later shop clicks and saves the same day
 * can be credited to the ad. Kept 90 days.
 */
export const adLandings = pgTable(
  "ad_landings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    gclid: text("gclid"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    path: text("path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ad_landings_visitor_idx").on(t.day, t.visitorHash), index("ad_landings_day_idx").on(t.day)],
);

/**
 * Addressable TV campaigns (Go3) measured by Trilio's own impression pixel
 * (/px/<slug>) and short link (/tv/<slug>). The salt makes viewer hashes
 * unlinkable across campaigns; it is deleted with them.
 */
export const tvCampaigns = pgTable("tv_campaigns", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  /** Where the short link leads, e.g. "/izvelies" or "/kategorija/fridge". */
  landingPath: text("landing_path").notNull().default("/"),
  salt: text("salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Daily counts per campaign: "impression" (pixel hits) and "link" (short-link opens). */
export const tvDaily = pgTable(
  "tv_daily",
  {
    slug: text("slug")
      .notNull()
      .references(() => tvCampaigns.slug, { onDelete: "cascade" }),
    day: date("day").notNull(),
    kind: text("kind").notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.slug, t.day, t.kind] })],
);

/**
 * One row per campaign, day and viewer: a hash of the platform's device id
 * (or, without one, the forwarded IP and user agent) with the campaign's salt.
 * Never the id, IP or user agent itself. Deleted 90 days after the day.
 */
export const tvViewers = pgTable(
  "tv_viewers",
  {
    slug: text("slug")
      .notNull()
      .references(() => tvCampaigns.slug, { onDelete: "cascade" }),
    day: date("day").notNull(),
    viewerHash: text("viewer_hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.slug, t.day, t.viewerHash] })],
);

export const adModeEnum = pgEnum("ad_mode", ["observe", "approve", "auto"]);
/** How often Claude reviews the account; reports and budget pacing run daily regardless. */
export const adReviewCadenceEnum = pgEnum("ad_review_cadence", ["weekly", "daily"]);

/** The owner's controls: one row (id 1). Money in cents. */
export const adSettings = pgTable("ad_settings", {
  id: integer("id").primaryKey().default(1),
  dailyBudgetCents: integer("daily_budget_cents").notNull().default(1500),
  floorCents: integer("floor_cents").notNull().default(500),
  /** Cost per weighted conversion the optimiser must stay under; null until Phase 0 data exists. */
  targetCostCents: integer("target_cost_cents"),
  clickWeight: integer("click_weight").notNull().default(1),
  saveWeight: integer("save_weight").notNull().default(3),
  mode: adModeEnum("mode").notNull().default("approve"),
  /** Proposal actions applied without asking in "auto" mode. */
  autoActions: jsonb("auto_actions").$type<string[]>().notNull().default(["add_negative", "pause_keyword"]),
  paused: boolean("paused").notNull().default(false),
  /** Weekly by default (owner, 24 Oct 2026): at 15 € a day one day's data is mostly noise. */
  reviewCadence: adReviewCadenceEnum("review_cadence").notNull().default("weekly"),
  /** ISO weekday of the weekly review: 1 = Monday … 7 = Sunday. */
  reviewWeekday: integer("review_weekday").notNull().default(1),
  /** When Google's numbers were last pulled, and the error if that pull failed. */
  reportsSyncedAt: timestamp("reports_synced_at", { withTimezone: true }),
  reportsError: text("reports_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adCampaignKindEnum = pgEnum("ad_campaign_kind", ["search", "pmax"]);
export const adStatusEnum = pgEnum("ad_status", ["draft", "enabled", "paused", "removed"]);

export const adCampaigns = pgTable("ad_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Google's resource name once synced ("customers/1/campaigns/2"). */
  googleId: text("google_id"),
  budgetGoogleId: text("budget_google_id"),
  name: text("name").notNull().unique(),
  kind: adCampaignKindEnum("kind").notNull().default("search"),
  /** The category group it serves (categories.json group id). */
  groupId: text("group_id").notNull(),
  status: adStatusEnum("status").notNull().default("draft"),
  budgetCents: integer("budget_cents").notNull().default(0),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adGroups = pgTable(
  "ad_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    googleId: text("google_id"),
    subcategoryId: text("subcategory_id").notNull(),
    name: text("name").notNull(),
    landingPath: text("landing_path").notNull(),
    cpcCapCents: integer("cpc_cap_cents").notNull().default(30),
    status: adStatusEnum("status").notNull().default("draft"),
  },
  (t) => [uniqueIndex("ad_groups_campaign_sub_idx").on(t.campaignId, t.subcategoryId)],
);

export const adMatchEnum = pgEnum("ad_match", ["exact", "phrase", "broad"]);

/** Keywords and negatives. A negative with no ad group applies to the whole campaign. */
export const adKeywords = pgTable(
  "ad_keywords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => adCampaigns.id, { onDelete: "cascade" }),
    adGroupId: uuid("ad_group_id").references(() => adGroups.id, { onDelete: "cascade" }),
    googleId: text("google_id"),
    text: text("text").notNull(),
    match: adMatchEnum("match").notNull().default("phrase"),
    negative: boolean("negative").notNull().default(false),
    status: adStatusEnum("status").notNull().default("draft"),
    /** "seed", "agent" or "owner". */
    source: text("source").notNull().default("seed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ad_keywords_unique_idx").on(t.campaignId, t.adGroupId, t.text, t.match, t.negative)],
);

/** Responsive search ads; PMax text assets live on the campaign's creatives. */
export const adAds = pgTable("ad_ads", {
  id: uuid("id").primaryKey().defaultRandom(),
  adGroupId: uuid("ad_group_id")
    .notNull()
    .references(() => adGroups.id, { onDelete: "cascade" }),
  googleId: text("google_id"),
  headlines: jsonb("headlines").$type<string[]>().notNull(),
  descriptions: jsonb("descriptions").$type<string[]>().notNull(),
  finalPath: text("final_path").notNull(),
  status: adStatusEnum("status").notNull().default("draft"),
  source: text("source").notNull().default("seed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adCreativeStatusEnum = pgEnum("ad_creative_status", [
  "draft",
  "approved",
  "rejected",
  "uploaded",
]);

/** Display images (rendered from a template with live data) and video scripts. */
export const adCreatives = pgTable("ad_creatives", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** "image" or "video_script". */
  kind: text("kind").notNull(),
  subcategoryId: text("subcategory_id").notNull(),
  /** "1200x628", "1080x1080", "1080x1920", "300x250" … (images only). */
  size: text("size"),
  headline: text("headline").notNull(),
  body: text("body").notNull(),
  /** Video scripts: scenes with on-screen text and seconds. */
  script: jsonb("script").$type<{ seconds: number; onScreen: string; visual: string }[]>(),
  status: adCreativeStatusEnum("status").notNull().default("draft"),
  googleAssetId: text("google_asset_id"),
  source: text("source").notNull().default("template"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Google's numbers per day and entity (our id), pulled by the daily job. */
export const adDailyStats = pgTable(
  "ad_daily_stats",
  {
    day: date("day").notNull(),
    /** "account" (entity ACCOUNT_ENTITY), "campaign", "ad_group", "keyword". */
    level: text("level").notNull(),
    entityId: uuid("entity_id").notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    conversions: real("conversions").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.level, t.entityId] })],
);

export const adSearchTerms = pgTable(
  "ad_search_terms",
  {
    day: date("day").notNull(),
    adGroupId: uuid("ad_group_id")
      .notNull()
      .references(() => adGroups.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    conversions: real("conversions").notNull().default(0),
    /** Claude's reading: "relevant", "irrelevant" or "unsure"; null until classified. */
    label: text("label"),
  },
  (t) => [primaryKey({ columns: [t.day, t.adGroupId, t.term] })],
);

export const adAgentRuns = pgTable(
  "ad_agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "daily" or "weekly". */
    kind: text("kind").notNull(),
    day: date("day").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ok: boolean("ok").notNull().default(false),
    summary: text("summary"),
    /** The weekly strategy memo, Markdown. */
    memo: text("memo"),
    proposals: integer("proposals").notNull().default(0),
    applied: integer("applied").notNull().default(0),
    blocked: integer("blocked").notNull().default(0),
    error: text("error"),
    /** The owner's reply to a memo, read into next week's context. */
    ownerNote: text("owner_note"),
  },
  (t) => [uniqueIndex("ad_agent_runs_kind_day_idx").on(t.kind, t.day)],
);

export const adProposalStatusEnum = pgEnum("ad_proposal_status", [
  "proposed",
  "applied",
  "rejected",
  "blocked",
  "failed",
]);

export const adProposals = pgTable(
  "ad_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => adAgentRuns.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull(),
    expectedEffect: text("expected_effect"),
    confidence: integer("confidence"),
    status: adProposalStatusEnum("status").notNull().default("proposed"),
    blockReason: text("block_reason"),
    decidedBy: text("decided_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("ad_proposals_status_idx").on(t.status, t.createdAt)],
);

/** What was sent to Google and what came back: the audit trail of the account. */
export const adChanges = pgTable("ad_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").references(() => adProposals.id, { onDelete: "set null" }),
  operation: jsonb("operation").$type<Record<string, unknown>>().notNull(),
  ok: boolean("ok").notNull(),
  response: text("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Search Console performance per day, query and page. */
export const seoQueries = pgTable(
  "seo_queries",
  {
    day: date("day").notNull(),
    query: text("query").notNull(),
    page: text("page").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    position: real("position").notNull().default(0),
    done: boolean("done").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.day, t.query, t.page] })],
);

export type AdSettings = typeof adSettings.$inferSelect;
export type AdCampaign = typeof adCampaigns.$inferSelect;
export type AdGroup = typeof adGroups.$inferSelect;
export type AdKeyword = typeof adKeywords.$inferSelect;
export type AdAd = typeof adAds.$inferSelect;
export type AdCreative = typeof adCreatives.$inferSelect;
export type AdProposal = typeof adProposals.$inferSelect;

/**
 * "Pieprasīt labāku cenu" without an account (docs/PRICE_NOTIFY_PLAN.md):
 * the e-mail a shopper typed, what they asked about and the exact consent text
 * shown, until they confirm by the link e-mailed to that address. Nothing is
 * sent to the address before that click; unconfirmed requests expire in 7 days.
 */
export const notifyRequests = pgTable(
  "notify_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    email: text("email").notNull(),
    kind: savedItemKindEnum("kind").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    subcategoryId: text("subcategory_id").notNull(),
    answersParam: text("answers_param"),
    label: text("label"),
    /** Where to return after confirming (a same-site path). */
    returnPath: text("return_path"),
    locale: text("locale").notNull().default("lv"),
    /** The consent text shown, e.g. "notify.body@2026-10-31"; includes Trilio's offers where Trilio sources (data/offers.json: every category). */
    consent: text("consent").notNull(),
    /** True when that text covered Trilio's own offers too. */
    offers: boolean("offers").notNull().default(false),
    visitorHash: text("visitor_hash"),
    adLandingId: uuid("ad_landing_id").references((): AnyPgColumn => adLandings.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** The confirmation also signs the person in, once. */
    signedInAt: timestamp("signed_in_at", { withTimezone: true }),
  },
  (t) => [
    index("notify_requests_email_idx").on(t.email, t.createdAt),
    index("notify_requests_visitor_idx").on(t.visitorHash, t.createdAt),
  ],
);

/**
 * First-party funnel events without cookies (docs/PRICE_NOTIFY_PLAN.md §5 PR 3):
 * one row per event, the day's anonymous visitor hash as in `visits`.
 */
export const uiEvents = pgTable(
  "ui_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    event: text("event").notNull(),
    subcategoryId: text("subcategory_id"),
    adLandingId: uuid("ad_landing_id").references((): AnyPgColumn => adLandings.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ui_events_day_idx").on(t.day, t.event)],
);

export type NotifyRequest = typeof notifyRequests.$inferSelect;

export const partnerRequestStatusEnum = pgEnum("partner_request_status", [
  "requested",
  "confirmed",
  "unavailable",
]);

/**
 * "Prasīts partnerim" (docs/CRM_PLAN.md §4): a product asked from a partner,
 * for the leads on it or for one paid order. The newest row wins; older rows
 * are the history. Partner names are free text (owner, 30 Oct 2026).
 */
export const partnerRequests = pgTable(
  "partner_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Set when the request is for one order; null for the product's leads and offers. */
    orderId: uuid("order_id").references(() => offerOrders.id, { onDelete: "cascade" }),
    status: partnerRequestStatusEnum("status").notNull().default("requested"),
    partner: text("partner"),
    /** The partner's own order number. */
    partnerOrderRef: text("partner_order_ref"),
    costCents: integer("cost_cents"),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("partner_requests_product_idx").on(t.productId, t.createdAt),
    index("partner_requests_order_idx").on(t.orderId),
  ],
);

/** The owner's notes on a lead (a product people saved), with who and when. */
export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_notes_product_idx").on(t.productId, t.createdAt)],
);

export type PartnerRequest = typeof partnerRequests.$inferSelect;

export const socialPostStatusEnum = pgEnum("social_post_status", [
  "draft",
  "approved",
  "published",
  "skipped",
  "failed",
]);

/** What a post is about (docs/SOCIAL_PLAN.md §3); "reel" is a video the owner uploaded. */
export type SocialKind =
  "picks" | "price_drop" | "advice" | "offer" | "top_categories" | "top_products" | "reel";

/**
 * One Facebook and Instagram post (docs/SOCIAL_PLAN.md): drafted from live
 * data a day before its slot, approved by the owner or automatically, then
 * published to both networks. `card` holds the facts the image is drawn
 * from, already anonymised; nothing about a shopper is ever stored here.
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<SocialKind>().notNull(),
    slotAt: timestamp("slot_at", { withTimezone: true }).notNull(),
    status: socialPostStatusEnum("status").notNull().default("draft"),
    subcategoryId: text("subcategory_id"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** Type "offer": the special offer it tells about, so one order is never told twice. */
    specialOfferId: uuid("special_offer_id").references(() => specialOffers.id, { onDelete: "set null" }),
    card: jsonb("card").$type<Record<string, unknown>>().notNull(),
    captionFb: text("caption_fb").notNull(),
    captionIg: text("caption_ig").notNull(),
    alt: text("alt").notNull(),
    link: text("link").notNull(),
    /** Reels only: a public URL Meta fetches the video from. */
    videoUrl: text("video_url"),
    /** "template" or "claude": who wrote the caption's lead sentence. */
    source: text("source").notNull().default("template"),
    fbPostId: text("fb_post_id"),
    igMediaId: text("ig_media_id"),
    error: text("error"),
    createdBy: text("created_by").notNull(),
    approvedBy: text("approved_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_posts_slot_idx").on(t.slotAt), index("social_posts_status_idx").on(t.status)],
);

/** Reach and reactions per post, network and day, pulled once a day. */
export const socialInsights = pgTable(
  "social_insights",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    network: text("network").$type<"facebook" | "instagram">().notNull(),
    day: date("day").notNull(),
    reach: integer("reach").notNull().default(0),
    reactions: integer("reactions").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    linkClicks: integer("link_clicks").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.network, t.day] })],
);

export type SocialPost = typeof socialPosts.$inferSelect;
