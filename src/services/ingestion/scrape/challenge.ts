// Recognises bot-protection pages (Cloudflare challenge or block, JavaScript
// cookie redirects). When a shop serves one, the scraper stops for that
// store: we never try to get around a site's bot protection. Those shops
// need a feed or an allow-listed crawler agreed with the shop.

const SIGNATURES: [RegExp, string][] = [
  [/<title>\s*Just a moment\.\.\.\s*<\/title>/i, "cloudflare_challenge"],
  [/Attention Required! \| Cloudflare/i, "cloudflare_block"],
  [/challenges\.cloudflare\.com|cf-chl-/i, "cloudflare_challenge"],
  [/<title>[^<]*(captcha|access denied|robot check)[^<]*<\/title>/i, "access_denied"],
];

export function detectBlock(body: string): string | null {
  for (const [re, reason] of SIGNATURES) if (re.test(body)) return reason;
  // A tiny page whose only job is to set a cookie in JavaScript and reload.
  if (body.length < 1024 && /document\.location(\.href)?\s*=|location\.replace\(/.test(body)) {
    return "javascript_challenge";
  }
  return null;
}
