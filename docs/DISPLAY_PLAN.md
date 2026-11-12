# Display campaigns and TV + display flights

Status: **built (12 Nov 2026).** Owner request: a banner campaign on a
publisher's site (tv3.lv, trafficked in Google Ad Manager) measured in the same
place as the Go3 TV campaigns, the overlap of the two audiences, and a way to
retarget. The lawyer approved linking a TV campaign and a display campaign for
one advertiser's flight.

## 1. Display campaign

Reklāma → TV creates campaigns of two kinds (`tv_campaigns.kind`): `tv` and
`display`. A display campaign has a publisher (`source`, e.g. `tv3.lv`).

- **Impression tracker:** `/px/<slug>` with Ad Manager's macros, added to the
  creative as a third-party impression tracker. The macros are taken from
  Google's own list (support.google.com/admanager/answer/2376981, read
  12 Nov 2026); they have not been tried in the publisher's account yet.

  | Field | Macro | What it gives |
  | --- | --- | --- |
  | `ord` | `%%CACHEBUSTER%%` | a random number, so no impression is served from a cache |
  | `cr` | `%ecid!` | the creative's id: which banner version |
  | `pl` | `%%ADUNIT%%` | the ad unit's path: where on the site it ran |
  | `ch` | `%%SITE%%` | the page's domain (empty on anonymous Ad Exchange ads) |
  | `pos` | `%%WIDTH%%x%%HEIGHT%%` | the banner's size |
  | `vid`, `idt`, `lat` | `%%ADVERTISING_IDENTIFIER_PLAIN%%`, `…_TYPE%%`, `…_IS_LAT%%` | in an app only: the device's advertising id, its type and the limit-ad-tracking flag. Empty on the web |
  | `tfua` | `%%TFUA%%` | 1 for a user under the age of consent: counted, never followed |
  | `pv` | `%%PREVIEW_MODE%%` | `true` for Ad Manager's own previews: not counted |

  Not used: `%%PATTERN:url%%` (the page's address would say what a person
  read), the GDPR consent macros (Trilio is not a TCF vendor and sets no
  cookie), and the order, advertiser and deal ids (one campaign is one line
  item). `%%PATTERN:<key>%%` can pass a publisher's own key-value, which is the
  way to an exact match with Go3 if the publisher has a shared sign-in id.
  An unfilled macro is never stored as a value.
- **Who calls it:** the visitor's browser, not an ad server. So the request's
  own address is the household's (`source = client`), there is no device id
  (reach is by address and browser, approximate), and requests from known
  crawlers are not counted.
- **Click link:** `/tv/<slug>`, as the banner's destination. It leads to the
  landing page with `utm_source=<publisher>&utm_medium=display&utm_campaign=<slug>`.
- **Channel:** `display` in the channel mix, not counted in the TV uplift
  (`docs/TV_ANALYTICS_PLAN.md` §8).
- **The card shows:** impressions, reach, clicks with the click rate, visits
  and shop clicks from the link, the household view-through (households that
  saw the banner and opened Trilio within 20 minutes or 7 days) and the pixel
  diagnostic. The TV effect (uplift against a baseline) is not shown: a banner
  runs all day, so "sessions after an impression" says nothing.

## 2. What it cannot do

- No viewability: Ad Manager's own report has viewable impressions; ours counts
  served ones.
- Clicks counted by us and by Ad Manager differ a little (bots, redirects).

## 3. Flight: TV and display compared

Each campaign hashes household addresses with its own salt, so nothing links
across campaigns. A **flight** links exactly two campaigns
(`linkFlight`): from that moment both use one shared salt
(`tv_campaigns.flight_salt`) for household hashes, on impressions and on the
site's own page views.

- The card of either campaign shows three groups since the link: households
  that saw only this campaign, only the other, or both, and how many of each
  opened Trilio after their first exposure (`flightOverlap`).
- Exposures from before the link are not compared (other salt).
- Household rows are kept 21 days, so the table covers the last 21 days.
- Unlinking, or deleting either campaign, ends the flight; the shared salt is
  dropped.
- **Exact device match (apps).** While a campaign is in a flight, a device's
  advertising id is hashed with the shared salt into `tv_viewers.device_hash`.
  The banner's tracker gets the id from Ad Manager in an app (`vid`); the Go3
  tracker gets it in `did` (`#{request.keyValue("_fw_did")}` in the extended
  tracker address; that key was written from memory of FreeWheel and is not
  verified with Go3). The card then shows devices seen by one campaign, the
  other, or both. Browsers have no such id, an opted-out device gets no hash,
  and unlinking clears the hashes.
- It is approximate: a phone on mobile data does not match the home address,
  and one address can be several people (or an office).

## 4. Retargeting

Trilio's hashes cannot be exported as an audience. Retargeting runs where the
person is known:

| Where | Audience | Set up by |
| --- | --- | --- |
| Publisher's site (Ad Manager) | saw or clicked the banner | the publisher's ad ops, as a first-party segment |
| Go3 | households that saw the spot | Go3 ad ops, by subscriber id |
| Meta, Google | reached trilio.lv from the banner or the TV link | the owner: a website audience with "URL contains `utm_medium=display`" (or `utm_medium=tv`) |

## 5. Privacy

The privacy notice has a "Baneru reklāmas mērījumi" item: the browser calls the
counter, the address and browser name become salted hashes at once, no cookie,
the shared salt for one advertising campaign, deletion after 21 days.

## 6. Tests

- `src/services/growth/tv-display.test.ts`: the tags and the channel, the
  Ad Manager tracker and unfilled macros, crawlers left out, the browser's
  address as the household, the flight's three groups, unlinking and deletion.
- `tests/e2e/tv.spec.ts`: a display campaign and a flight in the admin.
