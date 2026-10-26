# Connecting Google Ads and Search Console

Google changed API access on 9 September 2026. Developer tokens and the
manager account's API Center are retired. Access now belongs to a **Google
Cloud project**, so Trilio uses the same project that already runs "Turpināt
ar Google" (`docs/AUTH_SETUP.md`). Trilio signs in as a **service account** of
that project. Nobody's personal Google login is stored.

Sources: Google Ads API "Get access", "Access levels" and "Make your first
call" pages (checked 24 Oct 2026).

## 1. Google Cloud project (the one used for sign-in)

1. Check that **billing** is active on the project. Google currently rejects
   access applications from projects on the free trial or with billing off.
2. **APIs & Services → Library**: enable **Google Ads API** and **Google
   Search Console API**.
3. Open the **Google Ads API** page of the project (APIs & Services → Google
   Ads API → Overview). The access level starts at **Test**, which only reaches
   test accounts. Choose **Upgrade access level → Explorer**. Google usually
   approves it automatically.
   - Explorer allows 2 880 operations a day on real accounts. The first sync
     of all campaigns is about 600, and a normal day is a few dozen, so
     Explorer is enough to start.
   - **Basic** (15 000 a day) needs brand verification of the project first.
     Apply only if the admin shows quota errors.
4. **IAM & Admin → Service accounts → Create service account**, for example
   `trilio-ads`. It needs no project roles. Open it, then **Keys → Add key →
   Create new key → JSON**. A file downloads.
   - If key creation is blocked by an organisation policy, ask the
     organisation admin to allow it for this project.
   - Keep the file out of the repository and out of chats.

## 2. Google Ads account

1. Create the Google Ads account for trilio.lv with currency **EUR** and time
   zone **Europe/Riga**, and add billing. Skip the guided first campaign: Trilio
creates its own.
2. **Admin → Access and security → Users → +**: add the service account's
   e-mail (`trilio-ads@<project>.iam.gserviceaccount.com`) with **Standard**
   access. "Email only" access does not work for service accounts, and Admin
   cannot be granted at first.
3. Copy the 10-digit customer ID shown at the top of Google Ads.

A manager account is not needed. Set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` only if
the trilio.lv account is reached through one.

## 3. Search Console

**Settings → Users and permissions → Add user**: the same service account
e-mail, permission **Owner**. Note the property name: `sc-domain:trilio.lv` for
a domain property, or the full `https://trilio.lv/` for a URL-prefix property.

## 4. Railway variables

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The whole JSON key file pasted as the value, or its base64 (`base64 -w0 key.json`). |
| `GOOGLE_ADS_CUSTOMER_ID` | The 10-digit customer ID; dashes are fine. |
| `SEARCH_CONSOLE_SITE` | `sc-domain:trilio.lv` |
| `FEATURE_ADS` | `1` |

After the deploy, open **Admin → Reklāma** and press **Nosūtīt uz Google
(apturētas)**. Campaigns arrive paused. Check them in Google Ads, then switch
them on in **Kampaņas**.

If the admin shows "Google Cloud projektam ir tikai Test piekļuve", step 1.3
is still pending. If it shows "nav piekļuves šim Google Ads kontam", step 2.2
is missing or used a different e-mail.

## 5. The Google Ads tag and conversions

Google Ads shows a snippet with `gtag('config', 'AW-…')`. Don't paste it into
the site: it would load before the cookie banner, which EU law does not
allow. Trilio already loads the same gtag.js after "Atļaut". It only needs the
id:

| Variable | Value |
|---|---|
| `GOOGLE_ADS_TAG_ID` | `AW-18535248572` (the id in the snippet) |

For the optimiser to see results in Google too, create two conversion
actions. Go to **Goals → Conversions → New conversion action → Website**, then
"Add a conversion action manually":

1. "Pāreja uz veikalu", category **Outbound click** (or "Submit lead form"),
   value none, count **One**.
2. "Saglabāts vēlmju sarakstā", category **Add to cart** or **Other**, count
   **One**, and mark it **Secondary** so bidding does not chase it on its own.

Each shows an event snippet with
`'send_to': 'AW-18535248572/AbCdEf…'`. Copy the part after the slash into:

| Variable | Value |
|---|---|
| `GOOGLE_ADS_CONVERSION_SHOP_CLICK` | the label of the first action |
| `GOOGLE_ADS_CONVERSION_SAVE` | the label of the second action |

### Verifying the tag

Google's automatic check opens the page without accepting cookies. So it
finds no tag, and the status can say "Not verified" or "No recent activity".
That is expected with a consent banner and is not an error. To verify:

1. Open [tagassistant.google.com](https://tagassistant.google.com), add
   `https://trilio.lv` and connect.
2. In the window that opens, press **Atļaut** in the cookie banner.
3. Tag Assistant shows the tag `AW-…` firing. Click "Pirkt" on a result: the
   "conversion" event appears.

After the first real visitors accept cookies, the tag status in Google Ads
changes to "Active" by itself, usually within a day. A conversion action shows
"Recording conversions" after its first conversion.

## 6. Addressable TV (Go3)

Go3 inserts ads on its servers (server-side ad insertion) and calls third-party
impression trackers itself, filling FreeWheel macros such as
`#{request.keyValue("_fw_vcid2")}` (the viewer's device id), as for Adform,
Google and Gemius trackers. Google Ads cannot receive impressions from Go3, so
Trilio has its own tracker.

1. **Admin → Reklāma → TV → Jauna TV kampaņa.** Give a name, an optional short
   name for the link (for example `go3-ledusskapji`) and the page the short link
   leads to (for example `/izvelies` or `/kategorija/fridge`).
2. Copy **Pikseļa saite Go3** and give it to Go3 as the third-party impression
   tracker for that campaign:

   ```
   https://trilio.lv/px/go3-ledusskapji?ord=[timestamp]&vid=#{request.keyValue("_fw_vcid2")}
   ```

   Ask Go3 to confirm that `[timestamp]` is their cache-buster macro; if they
   use another (`[TIMESTAMP]`, `%%ADFRND%%`), replace it. The tracker answers
   with a 1×1 GIF at once and never fails an ad, also for an unknown campaign.
3. Show **Īsā saite** (`trilio.lv/tv/go3-ledusskapji`) on screen or as a QR code.
   It opens the chosen page tagged `utm_source=go3`, `utm_medium=tv`, so the
   visits, shop clicks and saves after it are credited to the campaign.

The TV tab shows impressions, reach (unique devices over the campaign),
short-link openings, visits and shop clicks, per day. The device id, IP and user
agent are never stored: only a hash with the campaign's own salt, deleted after
90 days. The privacy policy describes this.

## Alternative: a personal OAuth login

If a service account is not possible, Trilio also accepts an OAuth client of
the same project with a refresh token of a person who has access to the ads
account. Use the scopes `https://www.googleapis.com/auth/adwords` and
`https://www.googleapis.com/auth/webmasters.readonly`. Set
`GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` and
`GOOGLE_ADS_REFRESH_TOKEN`, and leave `GOOGLE_SERVICE_ACCOUNT_KEY` empty.
Don't reuse the website's sign-in client (`AUTH_GOOGLE_ID`). Create a separate
"Desktop app" client so the sign-in client keeps only the scopes it needs.

`GOOGLE_ADS_DEVELOPER_TOKEN` is no longer needed. If set, it is sent but
Google ignores it.
