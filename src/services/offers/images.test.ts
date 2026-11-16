import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { offerImages } from "@/db/schema";
import {
  addImage,
  checkLink,
  fetchImage,
  imageBytes,
  imagesOfSet,
  isPublicAddress,
  moveImage,
  processImage,
  purgeUnusedImages,
  removeImage,
  type Resolver,
} from "./images";

// Pictures for offers (docs/ALTERNATIVE_OFFER_PLAN.md §3.4): Trilio's own copy,
// at most 1600 px, JPEG without EXIF; links only to public https hosts.

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#4a7" } })
    .withMetadata({ exif: { IFD0: { Make: "TestCam", Copyright: "GPS 56.95,24.10" } } })
    .jpeg()
    .toBuffer();

describe("processImage", () => {
  it("fits into 1600 px, writes a JPEG and drops EXIF", async () => {
    const out = await processImage(await photo(3200, 1800));
    if (typeof out === "string") throw new Error(out);
    expect([out.width, out.height]).toEqual([1600, 900]);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(out.bytes.toString("latin1")).not.toContain("TestCam");
  });
  it("keeps a small picture small and refuses what is not a picture", async () => {
    const small = await processImage(await photo(400, 300));
    expect(typeof small !== "string" && [small.width, small.height]).toEqual([400, 300]);
    expect(await processImage(Buffer.from("<html>not a picture</html>"))).toBe("not_image");
    expect(await processImage(Buffer.alloc(11 * 1024 * 1024))).toBe("too_big");
  });
});

describe("links", () => {
  const resolve =
    (map: Record<string, string[]>): Resolver =>
    async (host) => {
      if (!map[host]) throw new Error("ENOTFOUND");
      return map[host]!;
    };
  it("knows private, loopback and link-local addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
      expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("accepts https on public hosts only", async () => {
    const r = resolve({ "images.example.com": ["93.184.216.34"], "inside.example.com": ["10.1.2.3"] });
    expect(await checkLink("https://images.example.com/a.jpg", r)).toBeInstanceOf(URL);
    expect(await checkLink("http://images.example.com/a.jpg", r)).toBe("bad_link");
    expect(await checkLink("https://inside.example.com/a.jpg", r)).toBe("blocked_host");
    expect(await checkLink("https://127.0.0.1/a.jpg", r)).toBe("blocked_host");
    expect(await checkLink("https://localhost/a.jpg", r)).toBe("blocked_host");
    expect(await checkLink("https://images.example.com:8443/a.jpg", r)).toBe("blocked_host");
    expect(await checkLink("https://user:pw@images.example.com/a.jpg", r)).toBe("bad_link");
    expect(await checkLink("nav saite", r)).toBe("bad_link");
  });
  it("follows a redirect only to another public host, and refuses what is not a picture", async () => {
    const r = resolve({ "a.example.com": ["93.184.216.34"], "b.example.com": ["93.184.216.35"], "evil.example.com": ["169.254.169.254"] });
    const bytes = await photo(10, 10);
    const fetcher = async (u: URL) => {
      if (u.pathname === "/to-b") return new Response(null, { status: 302, headers: { location: "https://b.example.com/p.jpg" } });
      if (u.pathname === "/to-evil")
        return new Response(null, { status: 302, headers: { location: "https://evil.example.com/latest/meta-data" } });
      if (u.pathname === "/page") return new Response("<html></html>", { headers: { "content-type": "text/html" } });
      return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } });
    };
    expect(Buffer.isBuffer(await fetchImage("https://a.example.com/to-b", { fetcher, resolve: r }))).toBe(true);
    expect(await fetchImage("https://a.example.com/to-evil", { fetcher, resolve: r })).toBe("blocked_host");
    expect(await fetchImage("https://a.example.com/page", { fetcher, resolve: r })).toBe("not_image");
    expect(await fetchImage("https://nowhere.example.com/x.jpg", { fetcher, resolve: r })).toBe("fetch_failed");
  });
});

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

run("stored pictures", { timeout: 30_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const setId = randomUUID();

  beforeAll(() => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
  });
  afterAll(async () => {
    await db.delete(offerImages).where(eq(offerImages.setId, setId));
    await end();
  });

  it("keeps up to four, needs a description, reorders and removes", async () => {
    const bytes = await photo(800, 600);
    expect(await addImage(db, { setId, bytes, alt: "  ", source: "upload", by: "admin@test" })).toEqual({
      ok: false,
      reason: "alt_missing",
    });
    const added = [];
    for (const n of [1, 2, 3, 4]) {
      const r = await addImage(db, { setId, bytes, alt: `Bilde ${n}`, source: "upload", by: "admin@test" });
      expect(r.ok).toBe(true);
      if (r.ok) added.push(r.image.id);
    }
    expect(await addImage(db, { setId, bytes, alt: "Piektā", source: "upload", by: "admin@test" })).toEqual({
      ok: false,
      reason: "too_many",
    });
    expect(await moveImage(db, setId, added[2]!, -1)).toBe(true);
    expect((await imagesOfSet(db, setId)).map((i) => i.alt)).toEqual(["Bilde 1", "Bilde 3", "Bilde 2", "Bilde 4"]);
    expect(await moveImage(db, setId, added[0]!, -1)).toBe(false);
    expect(await removeImage(db, setId, added[3]!)).toBe(true);
    expect(await imagesOfSet(db, setId)).toHaveLength(3);
    const stored = await imageBytes(db, added[0]!);
    expect((await sharp(stored!).metadata()).format).toBe("jpeg");
    expect(await imageBytes(db, "not-an-id")).toBeNull();
  });

  it("purges sets no offer uses after two days", async () => {
    expect(await purgeUnusedImages(db, new Date())).toBe(0);
    expect(await purgeUnusedImages(db, new Date(Date.now() + 3 * 24 * 3600 * 1000))).toBeGreaterThanOrEqual(3);
    expect(await imagesOfSet(db, setId)).toHaveLength(0);
  });
});
