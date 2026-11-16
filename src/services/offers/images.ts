import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "@/db/client";
import { offerImages, specialOffers } from "@/db/schema";

// Pictures the admin adds to an offer (docs/ALTERNATIVE_OFFER_PLAN.md §3.4): from a
// file or a link, always kept as Trilio's own copy, resized to at most 1600 px and
// re-encoded as JPEG without EXIF (location, camera), so an e-mail never loads a
// third-party server and nothing about where a photo was taken leaves with it.

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SIDE = 1600;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type ImageError =
  | "not_image"
  | "too_big"
  | "too_many"
  | "bad_link"
  | "blocked_host"
  | "fetch_failed"
  | "alt_missing";

export type Processed = { bytes: Buffer; width: number; height: number };

/** Decodes, turns upright, fits into 1600 px, flattens on white and writes a JPEG; metadata is dropped. */
export async function processImage(input: Buffer): Promise<Processed | ImageError> {
  if (input.byteLength > MAX_IMAGE_BYTES) return "too_big";
  try {
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    return "not_image";
  }
}

// ---------------------------------------------------------------- links

/** Private, loopback, link-local and other non-public addresses (IPv4 and IPv6). */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return false;
    if (x.startsWith("fc") || x.startsWith("fd")) return false; // unique local
    if (/^fe[89ab]/.test(x)) return false; // link-local
    if (x.startsWith("ff")) return false; // multicast
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPublicAddress(mapped[1]!);
    return true;
  }
  return false;
}

export type Resolver = (host: string) => Promise<string[]>;
const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** An https URL whose host resolves only to public addresses, or why not. */
export async function checkLink(raw: string, resolve: Resolver = dnsResolver): Promise<URL | ImageError> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "bad_link";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "bad_link";
  if (url.port && url.port !== "443") return "blocked_host";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicAddress(host) ? url : "blocked_host";
  if (!host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) return "blocked_host";
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return "fetch_failed";
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) return "blocked_host";
  return url;
}

export type Fetcher = (url: URL, init: { signal: AbortSignal }) => Promise<Response>;
const defaultFetch: Fetcher = (url, init) =>
  fetch(url, { ...init, redirect: "manual", headers: { accept: "image/*" } });

/** Fetches a picture by link: each redirect checked again, 10 s, 10 MB, image bytes only. */
export async function fetchImage(
  raw: string,
  deps: { fetcher?: Fetcher; resolve?: Resolver } = {},
): Promise<Buffer | ImageError> {
  const fetcher = deps.fetcher ?? defaultFetch;
  let target = await checkLink(raw, deps.resolve);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (typeof target === "string") return target;
    let res: Response;
    try {
      res = await fetcher(target, { signal });
    } catch {
      return "fetch_failed";
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return "fetch_failed";
      target = await checkLink(new URL(next, target).toString(), deps.resolve);
      continue;
    }
    if (!res.ok || !res.body) return "fetch_failed";
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream")) return "not_image";
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_IMAGE_BYTES) return "too_big";
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return "too_big";
        }
        chunks.push(value);
      }
    } catch {
      return "fetch_failed";
    }
    return Buffer.concat(chunks);
  }
  return "fetch_failed";
}

// ---------------------------------------------------------------- storage

export type OfferImage = { id: string; position: number; alt: string; width: number; height: number; source: string };

export function imagePath(id: string): string {
  return `/api/offer-images/${id}.jpg`;
}

export async function imagesOfSet(db: Db, setId: string | null | undefined): Promise<OfferImage[]> {
  if (!setId) return [];
  return db
    .select({
      id: offerImages.id,
      position: offerImages.position,
      alt: offerImages.alt,
      width: offerImages.width,
      height: offerImages.height,
      source: offerImages.source,
    })
    .from(offerImages)
    .where(eq(offerImages.setId, setId))
    .orderBy(asc(offerImages.position), asc(offerImages.createdAt));
}

/** Adds one processed picture to the end of a set (at most four). */
export async function addImage(
  db: Db,
  input: { setId: string; bytes: Buffer; alt: string; source: "upload" | "url"; sourceUrl?: string | null; by: string },
): Promise<{ ok: true; image: OfferImage } | { ok: false; reason: ImageError }> {
  const alt = input.alt.trim().slice(0, 200);
  if (!alt) return { ok: false, reason: "alt_missing" };
  const existing = await imagesOfSet(db, input.setId);
  if (existing.length >= MAX_IMAGES) return { ok: false, reason: "too_many" };
  const processed = await processImage(input.bytes);
  if (typeof processed === "string") return { ok: false, reason: processed };
  const [row] = await db
    .insert(offerImages)
    .values({
      setId: input.setId,
      position: existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0,
      bytes: processed.bytes,
      width: processed.width,
      height: processed.height,
      alt,
      source: input.source,
      sourceUrl: input.sourceUrl?.slice(0, 2000) ?? null,
      addedBy: input.by,
    })
    .returning();
  return {
    ok: true,
    image: { id: row!.id, position: row!.position, alt: row!.alt, width: row!.width, height: row!.height, source: row!.source },
  };
}

export async function removeImage(db: Db, setId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(offerImages)
    .where(and(eq(offerImages.setId, setId), eq(offerImages.id, id)))
    .returning({ id: offerImages.id });
  return rows.length > 0;
}

/** Moves a picture one place earlier (-1) or later (+1); the first is the main one. */
export async function moveImage(db: Db, setId: string, id: string, by: -1 | 1): Promise<boolean> {
  const list = await imagesOfSet(db, setId);
  const i = list.findIndex((x) => x.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return false;
  const order = [...list];
  [order[i], order[j]] = [order[j]!, order[i]!];
  for (const [n, img] of order.entries())
    await db.update(offerImages).set({ position: n }).where(eq(offerImages.id, img.id));
  return true;
}

export async function setAlt(db: Db, setId: string, id: string, alt: string): Promise<boolean> {
  const text = alt.trim().slice(0, 200);
  if (!text) return false;
  const rows = await db
    .update(offerImages)
    .set({ alt: text })
    .where(and(eq(offerImages.setId, setId), eq(offerImages.id, id)))
    .returning({ id: offerImages.id });
  return rows.length > 0;
}

export async function imageBytes(db: Db, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ bytes: offerImages.bytes }).from(offerImages).where(eq(offerImages.id, id));
  return row?.bytes ?? null;
}

/** Sets started in the form but never used by an offer, after two days (housekeeping). */
export async function purgeUnusedImages(db: Db, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
  const stale = await db
    .selectDistinct({ setId: offerImages.setId })
    .from(offerImages)
    .leftJoin(specialOffers, eq(specialOffers.imageSetId, offerImages.setId))
    .where(and(lt(offerImages.createdAt, before), isNull(specialOffers.id)));
  if (!stale.length) return 0;
  const rows = await db
    .delete(offerImages)
    .where(inArray(offerImages.setId, stale.map((s) => s.setId)))
    .returning({ id: offerImages.id });
  return rows.length;
}
