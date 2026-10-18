# Sign-in setup: Google and email

Trilio offers two ways to sign in: **Google** and an **email magic link**
sent through Resend. Each one appears on `/ienakt` only when its variables
are set, so you can turn them on one at a time. Sign in with Apple is
deferred (owner decision, 18 Oct 2026).

Before you start, the web service on Railway needs these two variables:

| Variable | Value |
|---|---|
| `AUTH_URL` | `https://trilio.lv` (the address people use, no trailing slash) |
| `AUTH_SECRET` | output of `openssl rand -base64 32` |

`APP_URL` should be the same address as `AUTH_URL`.

## 1. Google

Time needed: about 15 minutes. Cost: free.

1. Open [console.cloud.google.com](https://console.cloud.google.com) and sign
   in with the Google account that should own Trilio's login. A shared
   company account is better than a personal one.
2. Create a project: project picker at the top, **New project**, name it
   `Trilio`, then **Create**. Make sure the new project is selected.
3. Open **Google Auth Platform** (search for "OAuth consent screen" if the
   menu differs) and click **Get started**:
   - **App name:** `Trilio`
   - **User support email:** your address
   - **Audience:** **External**
   - **Contact information:** your address
   - Accept the policy and click **Create**.
4. **Branding** page:
   - **Application home page:** `https://trilio.lv`
   - **Authorised domains:** `trilio.lv`
   - Leave the logo empty for now. A logo makes Google review the app,
     which needs a privacy policy page and takes days.
5. **Data access** page: the default `openid`, `email` and `profile` scopes
   are all Trilio needs. Add nothing else.
6. **Audience** page: click **Publish app** so the status reads
   **In production**. While it says "Testing", only test users you list
   there can sign in.
7. **Clients** page: **Create client**:
   - **Application type:** Web application
   - **Name:** `Trilio web`
   - **Authorised JavaScript origins:** `https://trilio.lv`
   - **Authorised redirect URIs:** `https://trilio.lv/api/auth/callback/google`
   - For local development add `http://localhost:3000` and
     `http://localhost:3000/api/auth/callback/google` as well.
   - If people will also use `www.trilio.lv`, add the same two entries for
     that address.
8. Click **Create**. Copy the **Client ID** and **Client secret** (the
   secret is shown in full only once; download the JSON if offered).
9. In Railway, web service, **Variables**, add:

   | Variable | Value |
   |---|---|
   | `AUTH_GOOGLE_ID` | the Client ID, ending in `.apps.googleusercontent.com` |
   | `AUTH_GOOGLE_SECRET` | the Client secret, starting with `GOCSPX-` |

   Railway asks to redeploy. Accept.
10. Test: open `https://trilio.lv/ienakt`, click **Turpināt ar Google**,
    choose an account, and you should land on `/radars` signed in.

**If Google shows `redirect_uri_mismatch`:** the redirect URI in step 7
does not match the address in the browser exactly. Check `https`, `www` and
that there is no trailing slash, then save. Changes apply within a few minutes.

## 2. Email magic link (Resend)

Time needed: about 20 minutes plus DNS wait. Cost: free up to 3 000
emails a month.

Resend also sends the price radar alerts and payment receipts, so this one
setup covers all of Trilio's email.

1. Sign up at [resend.com](https://resend.com).
2. **Domains**, **Add domain**: enter `trilio.lv`, region **EU (Ireland)**
   (keeps email data in the EU).
3. Resend lists DNS records to add. Add each one in **Cloudflare**, DNS,
   exactly as shown, with proxy status **DNS only** (grey cloud). They
   usually look like this, but copy the values from Resend:

   | Type | Name | Content |
   |---|---|---|
   | TXT | `resend._domainkey` | long `p=...` key (DKIM) |
   | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com`, priority 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` (optional, recommended) |

   These live on the `send` subdomain and the DKIM name, so they do not
   touch your existing mailbox records (`MX trilio.lv → mx.trilio.lv` and
   the SPF record on `trilio.lv`). Keep those as they are.
4. Back in Resend, click **Verify DNS records**. It turns green within
   minutes to an hour.
5. **API keys**, **Create API key**: name `Trilio production`, permission
   **Sending access**, domain `trilio.lv`. Copy the key (starts with `re_`,
   shown once).
6. In Railway, web service, **Variables**, add:

   | Variable | Value |
   |---|---|
   | `RESEND_API_KEY` | the key from step 5 |
   | `EMAIL_FROM` | `Trilio <noreply@trilio.lv>` |

   Add the same two variables to the **ingest** cron service too, because
   it sends the price radar emails. Redeploy when asked.
7. Test: open `https://trilio.lv/ienakt`, enter your email, click the
   button, and open the link in the email within 15 minutes. Check the
   spam folder the first time.

**If the email never arrives:** in Resend, open **Emails** to see whether
it was sent, bounced or rejected. "Domain not verified" means step 4 is not
finished. "From address not allowed" means `EMAIL_FROM` uses a domain other
than `trilio.lv`.

## 3. Before launch

- **Privacy policy:** a page explaining what Trilio stores (email, saved
  radars, payment status) is needed under GDPR, and Google requires it if
  you add a logo to the consent screen.
- **Secrets:** the Google secret and the Resend key live only in Railway
  variables, never in the repository.
