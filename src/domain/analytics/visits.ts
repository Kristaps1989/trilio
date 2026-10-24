import { createHash } from "node:crypto";
import { pageInfo, type PageInfo } from "./page";

// First-party visit counting without cookies (docs/ADMIN_AND_OFFERS_PLAN.md §3),
// the method of Plausible and Fathom: a visitor is a hash of a random salt
// that changes every day, the IP address and the user agent. Nothing is
// stored on the device, and once a day's salt is deleted its hashes cannot
// be linked to anyone or to the next day.

const BOT =
  /bot|crawl|spider|slurp|preview|fetch|monitor|headless|lighthouse|pingdom|curl|wget|python-requests|axios|go-http|java\/|facebookexternalhit|embedly|whatsapp|telegram/i;

export function isBot(userAgent: string | null | undefined): boolean {
  return !userAgent || BOT.test(userAgent);
}

/** Paths that are not pages people read: the admin's own, APIs, files, payment redirects. */
const SKIP = /^\/(admin|api|_next|go|maksajums)(\/|$)|\.[a-z0-9]{2,5}$/i;

/** What to record for a page view, or null when it should not count. */
export function visitOf(rawPath: string, userAgent: string | null | undefined): PageInfo | null {
  if (isBot(userAgent)) return null;
  let path: string;
  let search = "";
  try {
    const url = new URL(rawPath, "https://trilio.invalid");
    path = url.pathname;
    search = url.search;
  } catch {
    return null;
  }
  if (path.length > 200 || SKIP.test(path)) return null;
  return pageInfo(path, search);
}

export function visitorHash(salt: string, ip: string, userAgent: string): string {
  return createHash("sha256").update(`${salt}\n${ip}\n${userAgent}`).digest("hex").slice(0, 32);
}

/** "YYYY-MM-DD" of an instant in Riga, the day a visit counts for. */
export function rigaDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Riga",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export const RAW_RETENTION_DAYS = 35;
