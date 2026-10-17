# Data model (proposal)

```
Store            id, slug, display_name, country, affiliate_template_url, feed_type(api|xml|csv), feed_url, active
Category         id, group_id, slug, label_lv, label_lt, label_et, question_schema(jsonb), compare_labels(jsonb), budget_steps(int[])
Product          id, ean (unique), brand, model_code, name_lv, category_id, attributes(jsonb: w,h,depth,volume_l,energy_class,noise_db,…),
                 tags(text[]), kwh_year, eprel_id, rating(numeric), image_url
Offer            id, product_id, store_id, condition(new|refurbished), grade, warranty_months, price_cents, currency,
                 stock(in|soon|out), delivery_eta_days, url, last_seen_at
PriceSnapshot    id, offer_id, price_cents, stock, captured_at          -- every ingestion run; powers 30-day low + sparkline
User             id, email, name, auth_provider(apple|google|email), locale, created_at
SearchSession    id, user_id?, category_id, answers(jsonb), created_at  -- saved requirements; also anonymised analytics
Radar            id, user_id, product_id, search_session_id, threshold(any|5|10), scope(only|brand|any),
                 store_ids(int[]), include_refurbished(bool), channels(text[]), paused(bool), created_at
RadarEvent       id, radar_id, offer_id, kind(drop|similar), old_price_cents, new_price_cents, sent_at
Subscription     id, user_id, psp_customer_id, psp_subscription_id, status, current_period_end, payment_method_label
WaitlistLead     id, email, free_text, detected_category?, created_at
AffiliateClick   id, session_id, offer_id, user_id?, clicked_at          -- commission reconciliation
```

## Data sources
- **Partner feeds** (product, price, stock, condition, ETA): ingest several times a day. Normalise on **EAN**, falling back to brand + normalised model code.
- **EPREL** (EU energy label database) for `energy_class` and `kwh_year`.
- **Public holidays** LV/LT/EE for working-day delivery dates.

## Radar evaluator (job)
After each ingestion, check every active radar:
1. The tracked product's best eligible offer, honouring the radar's store filter and new/refurbished choice.
2. Its price change against the price when the radar was created or last notified.
3. Whether that change meets the threshold.
4. If the scope is `brand` or `any`, the comparable products that satisfy the saved `answers`, the same size class and the same hard filters, with a meaningfully better price or total cost of ownership.

Notifications are debounced: no more than one per product per day.
