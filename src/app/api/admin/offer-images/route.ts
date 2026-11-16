import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { adminOrNull } from "@/app/[locale]/admin/guard";
import { audit } from "@/services/admin/audit";
import {
  MAX_IMAGE_BYTES,
  addImage,
  fetchImage,
  imagePath,
  imagesOfSet,
  moveImage,
  removeImage,
  setAlt,
} from "@/services/offers/images";

// The offer form's pictures (docs/ALTERNATIVE_OFFER_PLAN.md §3.4), admin only:
// POST adds one from a file or a link, PATCH moves one or changes its description,
// DELETE removes one. Every answer is the set as it now stands.

export const dynamic = "force-dynamic";

const setId = z.uuid();

async function listing(id: string) {
  const list = await imagesOfSet(db, id);
  return list.map((i) => ({ id: i.id, alt: i.alt, src: imagePath(i.id), width: i.width, height: i.height }));
}

export async function GET(request: Request) {
  if (!(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const id = setId.safeParse(new URL(request.url).searchParams.get("set"));
  if (!id.success) return NextResponse.json({ error: "bad_set" }, { status: 400 });
  return NextResponse.json({ images: await listing(id.data) });
}

export async function POST(request: Request) {
  const a = await adminOrNull();
  if (!a) return new NextResponse(null, { status: 404 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES + 64 * 1024) return NextResponse.json({ error: "too_big" }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "not_image" }, { status: 400 });
  }
  const id = setId.safeParse(form.get("set"));
  if (!id.success) return NextResponse.json({ error: "bad_set" }, { status: 400 });
  const alt = String(form.get("alt") ?? "");
  const file = form.get("file");
  const link = String(form.get("url") ?? "").trim();
  let bytes: Buffer;
  let source: "upload" | "url";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "too_big" }, { status: 413 });
    bytes = Buffer.from(await file.arrayBuffer());
    source = "upload";
  } else if (link) {
    if (form.get("rights") !== "1") return NextResponse.json({ error: "rights" }, { status: 400 });
    const fetched = await fetchImage(link);
    if (typeof fetched === "string") return NextResponse.json({ error: fetched }, { status: 400 });
    bytes = fetched;
    source = "url";
  } else return NextResponse.json({ error: "empty" }, { status: 400 });
  const added = await addImage(db, {
    setId: id.data,
    bytes,
    alt,
    source,
    sourceUrl: link || null,
    by: a.email,
  });
  if (!added.ok) return NextResponse.json({ error: added.reason }, { status: 400 });
  await audit(db, {
    adminEmail: a.email,
    action: "offer.image_add",
    targetType: "offer_image",
    targetId: added.image.id,
    details: { source, url: link || null },
    ip: a.ip,
  });
  return NextResponse.json({ images: await listing(id.data) });
}

const Patch = z.object({
  set: z.uuid(),
  id: z.uuid(),
  move: z.union([z.literal(-1), z.literal(1)]).optional(),
  alt: z.string().max(200).optional(),
});

export async function PATCH(request: Request) {
  if (!(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const p = Patch.safeParse(await request.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (p.data.move) await moveImage(db, p.data.set, p.data.id, p.data.move);
  if (p.data.alt !== undefined && !(await setAlt(db, p.data.set, p.data.id, p.data.alt)))
    return NextResponse.json({ error: "alt_missing", images: await listing(p.data.set) }, { status: 400 });
  return NextResponse.json({ images: await listing(p.data.set) });
}

export async function DELETE(request: Request) {
  const a = await adminOrNull();
  if (!a) return new NextResponse(null, { status: 404 });
  const q = new URL(request.url).searchParams;
  const set = setId.safeParse(q.get("set"));
  const id = z.uuid().safeParse(q.get("id"));
  if (!set.success || !id.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (await removeImage(db, set.data, id.data))
    await audit(db, {
      adminEmail: a.email,
      action: "offer.image_remove",
      targetType: "offer_image",
      targetId: id.data,
      ip: a.ip,
    });
  return NextResponse.json({ images: await listing(set.data) });
}
