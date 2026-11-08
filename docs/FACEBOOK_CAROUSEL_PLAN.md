# Facebook carousel: what Meta's documentation requires, and the fix

Owner's ask (8 Nov 2026), after the third attempt showed a carousel with no
pictures at all: "Review Meta documentation and implement based on that.
Write a plan for the carousel fix. Implement."

## 1. What Meta documents

From the Graph API reference for `POST /{page-id}/feed`
(developers.facebook.com/docs/graph-api/reference/page/feed):

- A carousel ("multi-link share") is a feed post with `child_attachments`:
  2–5 cards (10 with `multi_share_optimized`), each with `link`, and
  optionally `name`, `description` and `picture` (or `image_hash`).
- `picture`, `name` and `description` **customise** a link's preview, and
  customising is allowed only when **"the link must be owned by the posting
  Page"**. Ownership is read from the URL node:
  `GET /?id={url}&fields=ownership_permissions{can_customize_link_posts}`,
  and Meta says to call it **before posting new links**.
- A Page owns a link through **domain verification** in Meta Business Suite
  (Brand safety and suitability → Domains → verify `trilio.lv` with a meta
  tag, an HTML file or a DNS record) and **assigning the Page** to that domain
  ("Connected assets"). Facebook limited link-preview editing to verified
  domains in 2017 against clickbait.
- When the Page does **not** own the domain, Facebook ignores the card's
  `picture`/`name`/`description` and draws each card from **its own scrape of
  the card's link** (`og:image` etc.).

## 2. What that explains

| Date | What Trilio sent | What Facebook did |
| --- | --- | --- |
| 31 Oct (photo posts) | uploaded photos | pictures shown: no link involved |
| 2–8 Nov (link carousels) | `picture` on trilio.lv | ignored it (domain not owned), scraped each card's link: some scrapes got a picture, some did not |
| 8 Nov, PR 87 | `picture` and share page `og:image` on fbcdn.net | ignored `picture`; would not take an `og:image` on its own CDN: **no pictures at all** |

**Correction, 8 Nov 2026 (evening).** The owner showed Meta Business Suite:
`trilio.lv` is **verified** (owned by Sky Solutions SIA) and the Trilio Page is
in its **Connected assets**, and has been for a long time. So ownership was not
the cause: Facebook was entitled to use the cards' `picture`, and still drew
some cards without one. What is known for certain:

- 31 Oct–2 Nov: link carousels with `picture` on trilio.lv (under `/api/`)
  showed their pictures.
- 6–8 Nov: the same kind of post showed some or no pictures.
- 8 Nov (PR 87): `picture` on fbcdn.net showed **no** pictures: Facebook does
  not take a card picture from its own CDN.

The remaining suspect is the picture fetch itself (Facebook fetches each
card's `picture` once, when the post is made, and drops a slow or failed one
for good): a cold render after a deploy, several pictures drawn at once on a
small instance, or a reply that is not the picture. The code now records
**which** cards Facebook drew without a picture, so the next failure is
diagnosed from data, not from a guess.

## 3. The fix

1. **Ask Facebook first.** Before a carousel, read
   `ownership_permissions{can_customize_link_posts}` for the first card's link.
2. **Owned (domain verified and the Page assigned, as trilio.lv is):** a link
   carousel whose cards name their own square picture on trilio.lv, drawn and
   cached before the post (the arrangement that worked 31 Oct–2 Nov; a copy on
   Facebook's CDN is not taken, see above). The read-back stays: a carousel
   drawn without every picture is removed, the missing card numbers are logged
   (`[social] Facebook carousel … drawn without pictures (cards …)`), and the
   slides are posted as photos.
3. **Not owned, or the check fails:** no link carousel. The slides go out as a
   **multi-photo post** (photos uploaded unpublished, then one feed post with
   all of them, the link in the text): the pictures always show. Instagram is
   unchanged (its native carousel).
4. **Share pages** keep their own square picture as `og:image` (the fbcdn
   `?p=` from PR 87 is removed: Facebook does not take its own CDN as `og:image`).
5. **Admin → Sociālie tīkli** shows the domain state next to the connection:
   "trilio.lv apstiprināts: karuseļi ar saitēm" or "trilio.lv nav apstiprināts:
   karuseļi tiek publicēti kā foto" with the steps.
6. **„Publicēt Facebook vēlreiz”** follows the same rule, so the grey and
   text-only carousels are replaced by photo posts now, and by link carousels
   once the domain is verified.

## 4. For the owner

Nothing to set in Meta Business Suite: `trilio.lv` is verified and the Trilio
Page is connected (checked 8 Nov 2026). Admin → Sociālie tīkli shows Meta's own
answer to the ownership question after this deploy; if it ever says "nav
apstiprināts", the Page has come off the domain's Connected assets. If a
carousel still goes out as photos, the Railway log names the cards Facebook
drew without a picture.

## 5. Tests

- Provider: ownership read before the carousel; not owned → photos, no
  `child_attachments`; owned → uploads, cards with Facebook's copy, scrape,
  read-back; the ownership check failing counts as not owned; a link post is
  unchanged.
- Admin: the domain line in the connection panel (mock: owned).
- e2e: the share page names its own square picture whatever `?p=` says.
