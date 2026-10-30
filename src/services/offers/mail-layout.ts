// The branded HTML around Trilio's offer and order e-mails (docs/BRAND.md):
// a night-green header with the logo, a white card, a lime button. Tables and
// inline styles only, because that is what every mail client renders; the
// plain-text part of each message carries the same words.

const NIGHT = "#0F2A2E";
const LIME = "#D8F45A";
const MIST = "#F2F5F2";
const MUTED = "#4E605C";
const LINE = "#DDE5E2";
const VALUE = "#F1F8D6";
const FONT = "Figtree, 'Segoe UI', Helvetica, Arial, sans-serif";
const HEADING = "'Space Grotesk', 'Segoe UI', Helvetica, Arial, sans-serif";

/** HTML-escapes text; kept here so the layout stays free of server-only imports (the admin preview runs it in the browser). */
export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function paragraph(text: string, style = ""): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${NIGHT};${style}">${esc(text)}</p>`;
}

/** Small uppercase line above the headline. */
export function kicker(text: string): string {
  return `<p style="margin:0 0 10px;text-align:center;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED}">${esc(text)}</p>`;
}

/** The one sentence the e-mail is about, large and centred. */
export function hero(text: string): string {
  return `<h1 style="margin:0 0 12px;text-align:center;font-family:${HEADING};font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-0.5px;color:${NIGHT}">${esc(text)}</h1>`;
}

export function centred(text: string, style = ""): string {
  return `<p style="margin:0 0 20px;text-align:center;font-size:16px;line-height:1.5;color:${MUTED};${style}">${esc(text)}</p>`;
}

/** The product on its own: a large picture and the name beneath it. */
export function productHero(name: string, imageUrl: string | null): string {
  const img = imageUrl
    ? `<tr><td align="center" style="padding:8px 0 16px"><img src="${esc(imageUrl)}" width="220" height="220" alt="" style="display:block;width:220px;height:220px;object-fit:contain;border:0"></td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px">${img}<tr><td align="center" style="font-family:${HEADING};font-size:18px;line-height:1.35;font-weight:600;color:${NIGHT};padding:0 8px">${esc(name)}</td></tr></table>`;
}

/** The price as the largest thing on the page, with what it compares against in small print. */
export function priceHero(price: string, lines: string[]): string {
  const small = lines
    .filter(Boolean)
    .map((l) => `<p style="margin:4px 0 0;font-size:14px;line-height:1.4;color:${MUTED}">${esc(l)}</p>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px"><tr><td align="center" style="background:${VALUE};border-radius:16px;padding:20px 16px"><p style="margin:0;font-family:${HEADING};font-size:44px;line-height:1.1;font-weight:700;letter-spacing:-1px;color:${NIGHT}">${esc(price)}</p>${small}</td></tr></table>`;
}

export type Perk = { text: string; note?: string };

/** Short facts, one per line, each with a lime mark. */
export function perks(items: Perk[]): string {
  const rows = items
    .map((p) => {
      const note = p.note ? `<br><span style="font-size:14px;color:${MUTED}">${esc(p.note)}</span>` : "";
      return `<tr><td width="28" style="padding:8px 0;vertical-align:top"><span style="display:inline-block;width:18px;height:18px;border-radius:9px;background:${LIME};text-align:center;font-size:12px;line-height:18px;font-weight:700;color:${NIGHT}">&#10003;</span></td><td style="padding:8px 0;font-size:16px;line-height:1.45;color:${NIGHT}">${esc(p.text)}${note}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows}</table>`;
}

export function button(label: string, href: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 12px"><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:14px;background:${LIME}"><a href="${esc(href)}" style="display:inline-block;padding:17px 36px;font-family:${FONT};font-size:17px;font-weight:700;color:${NIGHT};text-decoration:none;border-radius:14px">${esc(label)}</a></td></tr></table></td></tr></table>`;
}

/** A quiet section under a thin rule: "Kāpēc lētāk?" and its answer, or the admin's own note. */
export function aside(title: string | null, text: string): string {
  const t = title
    ? `<p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${NIGHT}">${esc(title)}</p>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr><td style="border-top:1px solid ${LINE};padding:16px 0 0;font-family:${FONT}">${t}<p style="margin:0;font-size:15px;line-height:1.5;color:${NIGHT}">${esc(text)}</p></td></tr></table>`;
}

/** Plain paragraphs with clickable links, for the shorter order e-mails. */
export function paragraphsWithLinks(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(
      (para) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${NIGHT}">${esc(para)
          .replace(
            /https?:\/\/[^\s<]+/g,
            (u) => `<a href="${u}" style="color:${NIGHT};font-weight:600">${u}</a>`,
          )
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

export type Shell = {
  lang: string;
  /** The subject; screen readers and some clients show it as the page title. */
  title: string;
  baseUrl: string;
  /** Shown by mail apps next to the subject; hidden in the message. */
  preheader?: string;
  tagline: string;
  body: string;
  /** Small print under the card: why this e-mail came, unsubscribe, company. */
  footer?: string[];
  unsubscribe?: { label: string; url: string };
};

export function emailShell(s: Shell): string {
  const pre = s.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(s.preheader)}</div>`
    : "";
  const small = (s.footer ?? [])
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 6px">${esc(line)}</p>`)
    .join("");
  const unsub = s.unsubscribe
    ? `<p style="margin:0 0 6px"><a href="${esc(s.unsubscribe.url)}" style="color:${MUTED};text-decoration:underline">${esc(s.unsubscribe.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="${esc(s.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(s.title)}</title></head><body style="margin:0;padding:0;background:${MIST}">${pre}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MIST}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT}"><tr><td style="background:${NIGHT};border-radius:20px 20px 0 0;padding:18px 24px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle"><img src="${esc(s.baseUrl)}/email/logo.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td><td style="vertical-align:middle;padding-left:10px"><a href="${esc(s.baseUrl)}" style="font-family:${HEADING};font-size:24px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:-0.5px">trilio</a></td></tr></table><p style="margin:6px 0 0;font-size:13px;color:#A9BDB9">${esc(s.tagline)}</p></td></tr><tr><td style="background:#FFFFFF;border-radius:0 0 20px 20px;padding:28px 24px 12px">${s.body}</td></tr><tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.5;color:${MUTED};text-align:center">${small}${unsub}</td></tr></table></td></tr></table></body></html>`;
}
