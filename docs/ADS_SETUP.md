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
