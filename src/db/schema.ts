import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
export const paymentKindEnum = pgEnum("payment_kind", ["initial", "renewal"]);
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
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
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

export type Radar = typeof radars.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Plan = typeof plans.$inferSelect;
