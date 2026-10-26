import { createHash } from "node:crypto";

// Addressable TV measurement (Go3, server-side ad insertion). Go3's ad server
// calls a third-party tracker for every impression it inserts and fills the
// FreeWheel macro #{request.keyValue("_fw_vcid2")} with the viewer's device
// id, as it does for Adform, Google and Gemius trackers. Trilio's own tracker
// counts impressions and reach (unique devices) without keeping the id.

/** Campaign slug: lower-case letters, digits and dashes, as in /px/go3-oktobris. */
export const SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Go3's device-id macro, as the platform documents it for third-party trackers. */
export const GO3_VIEWER_MACRO = '#{request.keyValue("_fw_vcid2")}';

/** The impression tracker to give Go3: a 1×1 image, cache-busted with the timestamp macro. */
export function pixelUrl(base: string, slug: string): string {
  return `${base}/px/${slug}?ord=[timestamp]&vid=${GO3_VIEWER_MACRO}`;
}

/** The address to show on screen or in a QR code. */
export function shortLinkUrl(base: string, slug: string): string {
  return `${base}/tv/${slug}`;
}

/** Where the short link leads, with the campaign tags Trilio's attribution reads. */
export function landingWithTags(landingPath: string, slug: string): string {
  const sep = landingPath.includes("?") ? "&" : "?";
  return `${landingPath}${sep}utm_source=go3&utm_medium=tv&utm_campaign=${encodeURIComponent(slug)}`;
}

/**
 * The device id from the tracker's query, or null when it is missing or the
 * platform left the macro unfilled ("#{…}", "${…}", "[…]", "%%…%%").
 */
export function viewerId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 200) return null;
  if (/#\{|\$\{|^\[.*\]$|%%|_fw_vcid2/.test(v)) return null;
  return v;
}

/** A viewer's hash for one campaign: the id (or IP and user agent) never leaves this function. */
export function viewerHash(
  salt: string,
  input: { vid: string | null; ip: string | null; userAgent: string | null },
): string | null {
  const key = input.vid ? `id:${input.vid}` : input.ip ? `ip:${input.ip}|${input.userAgent ?? ""}` : null;
  if (!key) return null;
  return createHash("sha256").update(`${salt}|${key}`).digest("base64url").slice(0, 22);
}

/** A transparent 1×1 GIF, the smallest valid image a tracker can answer with. */
export const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
