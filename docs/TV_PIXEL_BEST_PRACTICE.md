# The TV pixel: what Adform, Google and Gemius do with one, and what Trilio should

Owner's ask (8 Nov 2026): "taking into account what Adform, Google, Gemius are
doing, how could I leverage the pixel more reasonably, based on global best
practice". This note records what those systems do with an impression pixel,
what Trilio's pixel does today, and the gap, in the order worth closing.

## 1. What Trilio's pixel does today

`GET /px/<campaign>?vid=<device id>&ord=<cache-buster>`, requested by Go3's ad
server for every inserted spot. Trilio keeps:

- impressions per minute (`tv_impressions`) and per day (`tv_daily`);
- one salted hash per device and day (`tv_viewers`) for reach (17 310 devices
  for 20 068 impressions on 8 Nov: frequency 1,16);
- uplift against a fixed pre-campaign baseline of site sessions per 10-minute
  bucket (`docs/TV_ANALYTICS_PLAN.md`), live and in the nightly rollup.

Nothing ties an impression to a later visit: the comparison is **aggregate in
time** (impressions in a bucket against sessions in the same bucket). That is
honest, but it is the weakest of the three methods below, and today it is also
polluted: the same script that produced 19 flagged shop clicks sits in the
sessions and in the baseline (`docs/CLICK_QUALITY_PLAN.md`), so "pieaugums 0,0"
says nothing yet.

## 2. What the measurement systems do

Three layers, from cheapest to most conclusive. Every serious system has all
three; the first is table stakes, the third is what a case study needs.

### 2.1 A richer impression: macros

An impression tracker is only as useful as the fields the ad server fills in.
Adform tracking points, Campaign Manager 360 / DV360 impression tags and
Gemius gemiusDirectEffect all ask for, and the ad servers all support, a set of
**macros** replaced at serving time ([DV360 macro list](https://support.google.com/displayvideo/answer/2789508),
[Roku's rules for third-party impression tags](https://help.ads.roku.com/en/articles/10386309-measuring-campaigns-with-third-party-solutions),
[Teads' CTV `[DEVICEID]`](https://help.teads.com/en/articles/7439253-supported-macros),
[MGID's `${TIMESTAMP}` / `${CAMPAIGN_ID}` / `${GDPR_CONSENT}`](https://help.mgid.com/managing-third-party-pixels-to-track-impressions-at-the-creative-level)).
What matters for addressable TV, in order:

| Field | Why | Trilio today |
| --- | --- | --- |
| Device / household id | reach, frequency, and the join key for a holdout | `vid` ✔ |
| Cache-buster | every impression counted | `ord` ✔ |
| **Viewer IP** (a macro, e.g. `[IP]`, `%%IP%%`) | with **server-side ad insertion the pixel is fired by the ad server**, so the request's own IP is Go3's data centre, not the household; the macro is the only way to get the household's IP, and the household IP is the key every CTV attribution method uses ([AppsFlyer](https://www.appsflyer.com/blog/measurement-analytics/ctv-measurement/), [Freshpaint on CM360 + CTV](https://documentation.freshpaint.io/integrations/destinations/advertising-destinations/thetradedesk/thetradedesk-with-cm360-configuration-guide)) | request IP only, probably the ad server's ✘ |
| Timestamp of the ad event | the server's clock, not Trilio's receipt time; SSAI beacons can arrive late or batched | receipt time ✘ |
| Creative id / spot length | which spot works (20 s vs a shorter cut; A/B of the copy) | none ✘ |
| Channel / programme / placement | which inventory brings visits (evening news vs. a film) | none ✘ |
| Position in the break, break type (pre/mid-roll) | first-in-break is worth more | none ✘ |
| Consent signals (`gdpr`, `gdpr_consent`) | the legal basis travels with the hit | none ✘ |

What to ask Go3 for: their **macro list** (the ad server behind Go3's dynamic
ad insertion publishes one; Adform, Google Ad Manager and FreeWheel all do),
and a pixel of the form
`/px/<campaign>?vid=[DEVICE]&ip=[IP]&ts=[TIMESTAMP]&cr=[CREATIVE]&ch=[CHANNEL]&pos=[POSITION]&ord=[CACHEBUSTER]`.
Every field Go3 cannot fill is simply absent; the code treats each as optional.

#### Go3 runs FreeWheel: the macros that exist (checked 9 Nov 2026)

The first version of this note gave placeholders (`[VIEWER_IP]`…). The owner
supplied the FreeWheel Macros Guide (Streaming Hub); the extended pixel now uses
FreeWheel's own macros:

| Field | FreeWheel macro | Caveat |
| --- | --- | --- |
| `vid` device id | `#{request.keyValue("_fw_vcid2")}` | as today |
| `ip` client address | `#{request.clientAddress}` | the viewer's address only when the SSAI passes it in the ad request as the VIP parameter; otherwise the SSAI server's. The diagnostic shows which. |
| `ts` time | `#{timestamp}` | Unix seconds when the ad server answered, close to the play time for stitched ads |
| `cr` / `crn` creative | `#{ad.creative.id}`, `#e{ad.creative.name}` | |
| `ss` site section name | `#e{section.title}` | "Site Section Name" in Go3's reports (`DAI_…`): device, environment, live/catch-up/VOD and channel; the primary field |
| `csid` site section custom id | `#e{section.customId}` | fallback only: not verified to hold the same `DAI_…` string at Go3 |
| `ch` channel | `#e{sa.channel}` | standard attribute; may be empty where the CSID already says it |
| `dt` device type | `#e{sa.platform.deviceType}` | |
| `pos` | `#{slot.timePositionClass}` | preroll, midroll, postroll: where in the programme the break was, shown as it comes |
| `co` viewer country | `#{request.country}` | the viewer's country; the CSID's `_LV/_EE/_LT` is the channel's feed, not this |
| `lat` opted out | `#{request.deviceOptOut}` | 1 when the device opted out of ad tracking (LAT, ATT, `_fw_opt_out`): the impression is counted, but no device, address or household hash is kept |
| `idt` device id type | `#{request.deviceIdType("iab")}` | tifa, rida, aaid, idfa…: which kind of id `vid` is |
| `dur` spot length | `#{ad.creative.rendition.duration}` | seconds; tells a 20 s spot from a cut-down |
| `pg` / `ast` programme | `#e{series.title}`, `#e{asset.title}` | the series, else the asset: which programmes bring visits |
| `gn` genre, `dp` daypart | `#e{sa.genre}`, `#e{sa.contentdaypart}` | |
| `pl` placement | `#e{ad.placement.name}` | several placements under one campaign address |
| `ua` device user agent | `#e{request.userAgent}` | like the address: the device's only if the SSAI forwards it |
| `gdpr` | `#{GDPR}` | the TCF flag; only its presence is counted, the consent string is not asked for |

Considered and left out: `#{request.zipcode}` (finer than the measurement
needs), `#{GDPR_CONSENT_285}` (the consent string itself), `#{slot.position}`,
`#{request.videoRandom}` and the programmatic and click macros (no use for an
impression tracker), `#{sa.platform.os}` and `#{sa.platform.environment}` (the
CSID already says them).

`#e{…}` URL-encodes a value. A macro FreeWheel leaves unexpanded (`#{…}`,
`#e{…}`, `#s{…}`, `#2{…}`) is ignored. `#{ad.random}` and `#{ad.ref.random}` are
not supported for partner tags and are not used. The tracker Go3 already runs
(`ord=[timestamp]`) keeps working; `ord` is only a cache-buster.

#### Go3's site section, decoded (owner, 9 Nov 2026)

Go3's FreeWheel site section has the form `DAI_<device>_<environment>_<placement>`
(`DAI_smarttv_other_PR_TV3_Life_LV_HD_HVC`), the "Site Section Name" of its
reports, which FreeWheel's guide names `#{section.title}`. The pixel takes the
name (`ss=#e{section.title}`) first; the custom id (`csid=#e{section.customId}`,
a "custom site section tag") is used only when it, not the name, has that form,
or when no name came. `src/domain/growth/go3-section.ts` follows the rules of the Go3
Go dashboards:

- **device:** `smarttv`, `browser`, `android` or `ios`;
- **screen:** television, desktop web or mobile app;
- **content type:** catch-up if the placement contains `catchup`, on-demand if it
  contains `vod`, otherwise live;
- **channel** (live only): `PR_` and `_HVC` removed, every `_HD` removed, the feed
  suffix `_LV`, `_EE` or `_LT` removed, `3plus` written as `3+`.

The feed suffix names the channel's feed, not where the viewer is: the viewer's
country comes from `#{request.country}`. The TV tab shows impressions per screen,
content type, device and live channel; the raw sections stay in the table below them.

### 2.2 View-through attribution by household

This is what "post-impression" (Gemius), "view-through conversion" (Google) and
Adform's cross-device attribution mean in practice on TV, where nobody clicks:
the household's IP at the impression is matched to the IP of a later visit on
another device ([Teqblaze](https://teqblaze.com/blog/ctv-attribution),
[Causality Engine](https://www.causalityengine.ai/resources/connected-tv-attribution)).
Industry practice:

- **Window:** a short "direct response" window (Trilio's 0–20 min is the right
  one for "they picked up the phone") **and** a longer view-through window.
  Vendors recommend 7–14 days for e-commerce ([NA Media Experts](https://www.namediaexperts.com/blog-posts/how-to-measure-ctv-attribution-2026-step-by-step-guide));
  Google caps lookback at 90 days and advises far less. Report both, never
  only the long one.
- **Match quality:** household IP matching is probabilistic (one IP can be a
  block of flats or a mobile carrier's NAT); vendors quote 70–85 % accuracy
  with a device graph, which Trilio does not have. Treat matched visits as
  **directional**, and say so in the case study.
- **Privacy:** an IP address is personal data under GDPR. Store a **salted
  hash** of the household IP (as `tv_viewers` already does for the device id),
  a daily salt for the visit side, keep the join for 14 days, and list the
  processing in the privacy notice (legitimate interest: campaign measurement,
  no profiling). Never store the raw IP, never join to an account.

With the IP macro in place the figures become: *households reached*, *matched
households that visited within 20 min / 7 days*, *matched visit rate vs. the
visit rate of unexposed Latvian traffic*, *shop clicks and „Iegūt lētāk"
requests from matched households*. That is the Google/Adform report, built on
Trilio's own data.

### 2.3 Incrementality: a control group

Every source agrees attribution over-credits the ad; the check is a **holdout**
([Fusepoint](https://fusepointinsights.com/blog/ctv-measurement-incrementality-brand-lift-roi/),
[AppsFlyer](https://www.appsflyer.com/blog/measurement-analytics/ctv-measurement/)):
10–20 % of the target households never see the spot (or see a public-service
spot), and the visit rate of exposed vs. holdout households is the uplift. Only
the ad server can create one. Ask Go3 for either:

1. **A device-level holdout:** 10–15 % of eligible devices suppressed, their
   device ids (or IPs) fired to the same pixel with `grp=control`. Trilio then
   compares visit rates of the two groups by household IP. This is the gold
   standard and is standard practice in CTV measurement.
2. **A time-based split** if Go3 cannot suppress by device: alternate on/off
   hours (or days) within the flight. Trilio's bucket model already supports
   this: buckets with impressions against buckets of the same hour on off
   days replace the pre-campaign baseline, which is fairer because it
   controls for the season and the weekday.

A pre/post baseline alone (today's method) is the weakest control: anything
else that changed in the week (PR, the Facebook posts, the weather) is credited
to TV.

### 2.4 Hygiene the three systems share

- **Reconcile counts** with Go3's delivery report daily; a discrepancy above
  5–10 % is a tracking problem, not a result.
- **Frequency distribution**, not only reach: devices at 1, 2, 3+ exposures.
  TV response is non-linear; the case study should show the visit rate by
  frequency band once IPs are matched.
- **Clean sessions first** (`docs/CLICK_QUALITY_PLAN.md`): sessions that come
  from flagged visitors are excluded from both sides of every comparison and
  from the baseline, which is recomputed. This is a precondition for every
  figure above.
- **Brand search** (Search Console, already in the report) is the accepted
  secondary signal for TV: slow (2–3 days of latency), but immune to bots and
  IP matching.
- **Short link / QR** (`/tv/<campaign>`): keep it, expect little. 0 opens from
  20 068 impressions is normal for a 20 s spot without a QR code on screen.

## 3. What to build, in order

| Step | What | Depends on | Size |
| --- | --- | --- | --- |
| 0 | Clean sessions and baseline of flagged visitors; recompute | nothing | ½ day (planned with the bot filter) |
| 1 | Pixel accepts `ip`, `ts`, `cr`, `ch`, `pos`, `grp`; stores salted household-IP hash per impression (14 days), creative and channel per impression; admin shows per-creative and per-channel impressions and reach, frequency bands | Go3's macro list | 1 day |
| 2 | Household view-through: salted IP hash on visits (14 days); matched visits 0–20 min and 7 days; matched shop clicks and requests; the case study's "households that came" section | step 1, with a real `[IP]` macro | 1 day |
| 3 | Holdout: `grp=control` impressions, visit rate exposed vs. control, confidence interval | Go3 agreeing to a holdout | ½ day |
| 3b | Time split fallback: on/off hours as the control, replacing the pre-period baseline | Go3's flight plan | ½ day |

Steps 1–2 are the "leverage the pixel" part and need one thing from Go3: the
list of macros their ad server can fill, above all the viewer's IP and the
creative id. Without the IP macro, the pixel can only ever count.

## 3a. Built (9 Nov 2026)

- **Step 0:** see `docs/CLICK_QUALITY_PLAN.md` §6, plus "Pārrēķināt bāzi" on the TV tab.
- **Diagnostic:** every pixel request counts which headers came (X-Forwarded-For
  and its hops, X-Device-IP, X-Device-User-Agent and the like), which macros
  were filled, the requester's and the device's family (Samsung Tizen, LG webOS,
  "server: okhttp"…), and the number of distinct addresses per source as
  day-keyed hashes (`tv_pixel_counts`, `tv_pixel_addresses`). The TV tab's
  "Ko pikselis saņem" table answers the owner's question of 8 Nov (does the SSAI
  enrich the headers?) from the first evening of data: many distinct
  first-hop or device addresses mean households; a handful mean Go3's servers.
- **Step 1:** the pixel takes `ip`, `ts`, `cr`, `ch`, `pos` and `grp`; the TV tab
  shows the extended pixel address for Go3 (placeholders for Go3 to replace with
  its macros) and the holdout's address (`grp=control`), impressions per
  creative, channel and position, and the frequency bands (devices by
  impressions over the period, counted from 9 Nov).
- **Step 2:** household exposures (`tv_exposures`) and the household side of
  people's page views (`tv_household_visits`), both salted hashes per campaign,
  kept 21 days; per day the households exposed, those that came 0–20 minutes
  after an exposure and within 7 days. The address source is chosen per day:
  the macro, the device header, or forwarded addresses only when they are many
  (at least a third of the devices reached). Stored in `tv_uplift.households`
  nightly for the last 8 days, so the case study keeps them.
- **Step 3:** holdout calls are counted apart (never as impressions), and the
  exposed-vs-holdout lift is shown with a 95 % interval.
- **Step 3b:** "Dienas bez TV kampaņas laikā": with two or more days without
  impressions inside the flight, the same buckets on those days are the
  expected sessions, beside the pre-campaign baseline.
- **For the owner's assistant:** `GET /api/stats/tv` and `/api/stats/site`
  (`?periods=today|7|30|90`) return the same figures as JSON with
  `Authorization: Bearer $STATS_API_TOKEN` (404 without it).
- **Privacy notice** updated: the household address is hashed per campaign,
  matched to visitors' addresses hashed alike, kept 21 days, totals only.

## 4. Sources

- [DV360 / CM360 supported macros](https://support.google.com/displayvideo/answer/2789508)
- [Freshpaint: CM360 view-through, cookie then IP matching, IP for CTV](https://documentation.freshpaint.io/integrations/destinations/advertising-destinations/thetradedesk/thetradedesk-with-cm360-configuration-guide)
- [Roku: rules for third-party impression tags (Adform among approved vendors)](https://help.ads.roku.com/en/articles/10386309-measuring-campaigns-with-third-party-solutions)
- [Teads: CTV macros incl. device id](https://help.teads.com/en/articles/7439253-supported-macros)
- [MGID: third-party pixel macros incl. GDPR consent](https://help.mgid.com/managing-third-party-pixels-to-track-impressions-at-the-creative-level)
- [Gemius gemiusDirectEffect: site-centric measurement, real users](https://directeffect.gemius.com/en/product/measure/)
- [Gemius AdOcean: cookieless tracking scripts](https://newsletter.gemius.com/adocean/en/cookieless-scripts-fa4aba98-5c76-48fb-b785-866e3aa/)
- [AppsFlyer: CTV measurement, household IP matching, incrementality](https://www.appsflyer.com/blog/measurement-analytics/ctv-measurement/)
- [Teqblaze: CTV attribution](https://teqblaze.com/blog/ctv-attribution)
- [Fusepoint: CTV incrementality and holdouts](https://fusepointinsights.com/blog/ctv-measurement-incrementality-brand-lift-roi/)
- [NA Media Experts: view-through windows](https://www.namediaexperts.com/blog-posts/how-to-measure-ctv-attribution-2026-step-by-step-guide)
- [Causality Engine: CTV attribution without cookies](https://www.causalityengine.ai/resources/connected-tv-attribution)
- [IAB Europe CTV measurement framework (draft)](https://iabeurope.eu/wp-content/uploads/For-public-comment_CTV-MEASUREMENT-FRAMEWORK.pdf)
- [C21: TV3 Group's addressable advertising on Go3 since 2023](https://www.c21media.net/department/cee100/tv3-eyes-new-ad-models-and-backs-local-content/)
