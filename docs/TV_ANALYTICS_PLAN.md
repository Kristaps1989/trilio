# TV analytics — measuring addressable TV with Trilio's own data

Owner's ask (6 Nov 2026): a Go3 addressable TV campaign is running with the
20 s spot. TV is not clickable; viewers type **trilio.lv** on their own
devices. The owner needs to see whether the spots move traffic, and will
prepare a case study for Go3 on how ATV works for a new business. Keep the
short link (`/tv/<campaign>`): it may serve another campaign.

Everything below uses data Trilio already collects: the impression pixel
(`/px/<campaign>`), first-party page views (`visits`), shop clicks and, where
Search Console is connected, brand searches. No new personal data: the pixel
keeps minute totals, never a device id.

## 1. What addressable TV looks like in the data

Go3 inserts the spot per household at that household's own ad break, so
impressions arrive **continuously** through the evening, not at one
"spot time" as on linear TV. The measurement therefore works in **10-minute
buckets** of the day (144 per day), not around single spots:

- `I(b)`: impressions in bucket `b` (from the pixel, per minute, summed).
- `S(b)`: **sessions** that start in bucket `b`: a page view by a visitor with
  no page view in the previous 30 minutes. Sessions, not page views, so one
  person reading five pages counts once.
- `B(b)`: the **baseline**: the average sessions in bucket `b` over the 14
  days before the campaign's first impression (fewer if the site is younger),
  stored once per campaign so the comparison never moves under the data.

A bucket is **"after TV"** when `I` is above zero in it or in the previous
bucket (a response window of 0–20 minutes: the viewer picks up the phone
during or just after the spot).

Per campaign day:

| Figure | Meaning |
| --- | --- |
| Parādījumi | impressions that day |
| Buckets with TV | buckets after TV |
| Apmeklējumi pēc TV | sessions in after-TV buckets |
| Gaidāmie | Σ `B(b)` over those buckets: what the same minutes brought before the campaign |
| Pieaugums | `max(0, after − expected)`: the sessions the spots add |
| Pieaugums, % | `after / expected − 1` when expected is above zero |
| Rezultāti pēc TV | sessions after TV that reached a results page (`section = results`) the same session |
| Klikšķi uz veikaliem pēc TV | shop clicks in after-TV buckets |
| Tālruņi pēc TV | share of after-TV sessions from Android or iOS |
| Korelācija | Pearson `r` between `I(b)` and `S(b) − B(b)` over the day's 144 buckets |

The 24-hour profile (impressions, sessions and baseline per bucket) is the
chart Go3 cares about: the evening's impressions and the sessions rising with
them, against the flat line of the weeks before.

## 2. Data

- **`tv_impressions`** (new): `slug`, `minute` (timestamptz, truncated), `hits`.
  Written by the pixel beside `tv_daily`. Tiny: at most 1 440 rows a day per
  campaign. Kept as long as the campaign.
- **`tv_campaigns.baseline`** (new jsonb): `{ from, to, days, sessions: number[144] }`,
  set by the first nightly rollup after the first impression, from raw
  `visits` of the 14 days before it. Never recomputed, so the case study's
  comparison stays fixed. Empty until then.
- **`tv_uplift`** (new): one row per campaign and day with the figures of §1
  plus `buckets: [impressions, sessions][144]`. Written by the nightly
  housekeeping for finished days (idempotent) and computed live for today.
  This outlives the 35-day raw-visit retention, so the case study can be
  written months later.
- Brand searches: `seo_queries` where the query contains "trilio", summed per
  day. Shown only when Search Console pulls exist.

## 3. Where it shows

- **Reklāma → TV**, per campaign: an "Ietekme" block (sessions after TV,
  expected, uplift, uplift %, correlation over the campaign), the 24-hour
  profile chart for the campaign so far, the per-day table extended with the
  figures of §1, and a link to the case-study page. The short link and pixel
  stay as they are.
- **Period switch (owner, 7 Nov 2026):** the TV tab has Šodien / 7 dienas / 30 dienas (`?periods=today|7|30`, 7 days by default); impressions, reach, link openings, visits, shop clicks, the effect block, the 24-hour profile and the per-day tables all cover the chosen days. The report adds "Visa kampaņa" (its default, for the case study) and shows the period in its facts.
- **Reklāma → TV → Pārskats** (`/admin/reklama/tv/<slug>/parskats`): the
  printable case-study page, white on print: campaign facts, the summary
  figures, impressions and uplift per day, the 24-hour profile, brand
  searches per day before and during the campaign, the funnel after TV,
  the method in three sentences. A "Drukāt" button; the browser's PDF is the
  file for Go3.

## 4. Honesty

- Uplift is an estimate: the baseline is the same weekday minutes before the
  campaign, and other causes (Meta ads, press) land in the same minutes. The
  page says so. Correlation across buckets is the honest check: a high `r`
  with a positive uplift is a campaign effect; a high uplift with `r` near
  zero is something else.
- A day with no baseline (campaign started before any visits existed) shows
  sessions after TV without an uplift figure.
- Nothing is attributed by device: the pixel's viewer hashes stay for reach
  only, as before.

## 5. Tests

- `src/domain/growth/uplift.test.ts`: sessions from page views (30-minute
  gap), buckets, baseline, after-TV windows, uplift and correlation on
  synthetic days; empty and single-bucket cases.
- `src/services/growth/tv.test.ts`: impressions per minute, the baseline from
  earlier visits, the uplift row for a day, idempotent rollup, deletion with
  the campaign.
- `tests/e2e/tv.spec.ts`: after the pixel hits and a viewer's visit, the
  campaign shows sessions after TV ≥ 1 and the 24-hour chart; the case-study
  page opens, passes axe, has the print button and the method text.
- `src/services/growth/tv-channels.test.ts`: Meta and non-brand Google ad
  visitors stay out of the uplift and the baseline but show in the mix; an old
  baseline is redrawn once, or marked `all` when its raw visits are gone.

## 8. Channels

TV can only cause visits that arrive without another campaign's click. Each
visitor-day gets one channel from its first landing of the day
(`src/domain/growth/channels.ts`); a day with no landing is **direct**.

| Channel | From | Counted in the uplift |
| --- | --- | --- |
| direct | no tags (typed address, bookmark, organic, untagged e-mail) | yes |
| tv | `utm_medium=tv` (the `/tv/<slug>` short link) | yes |
| google_brand | `gclid` or paid Google with „trilio" in the term or campaign | yes |
| google | other paid Google | no |
| meta_ads | Facebook/Instagram with a paid medium, or a bare `fbclid` | no |
| social | unpaid Facebook/Instagram, `utm_medium=social` | no |
| email | `utm_medium=email` or source email/newsletter | no |
| other | any other tagged source | no |

- Name Google brand campaigns (or their keywords) with „trilio" so brand
  searches after a spot count as TV's effect.
- Our own e-mails are untagged today, so their visitors count as direct.
- `fbclid` without UTM tags is captured as `facebook / fbclid` (Meta ads).
- The baseline is drawn with the same filter and records `filter:
  "tv-eligible-v1"`. A baseline drawn before the filter is redrawn once, by the
  nightly rollup, while its days are still in the raw visits (35 days);
  otherwise it is kept and marked `filter: "all"`.
- The TV page and `/api/stats/tv` show the channel mix next to the uplift, so
  a busy Meta day is visible and not mistaken for TV.
