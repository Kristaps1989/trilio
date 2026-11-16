"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type DragEvent } from "react";
import { Button } from "@/ui/Button";
import { inputClass, labelClass } from "../ui";

// "Bildes un apraksts" (docs/ALTERNATIVE_OFFER_PLAN.md §3.4): up to four pictures
// from the computer (drag and drop, or the camera and gallery on a phone) or from
// a link. The server keeps its own resized copy without EXIF; the first is the main
// one. Each needs a short description for screen readers, prefilled with the name.

export type Picture = { id: string; alt: string; src: string };

type Props = {
  setId: string;
  defaultAlt: string;
  /** The catalogue's picture, used when no picture is added here. */
  catalogImage: string | null;
  initial?: Picture[];
  /** Told about every change, so the e-mail preview shows the pictures. */
  onChange?: (pictures: Picture[]) => void;
};

const MAX = 4;
const MAX_BYTES = 10 * 1024 * 1024;

export function OfferPictures({ setId, defaultAlt, catalogImage, initial = [], onChange }: Props) {
  const t = useTranslations("admin.pictures");
  const [pictures, setList] = useState<Picture[]>(initial);
  const setPictures = (next: Picture[]) => {
    setList(next);
    onChange?.(next);
  };
  const [link, setLink] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = pictures.length >= MAX;

  const say = (code: string) => setError(t.has(`error.${code}`) ? t(`error.${code}`) : t("error.failed"));

  async function send(body: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/offer-images", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { images?: Picture[]; error?: string };
      if (data.images) setPictures(data.images);
      if (!res.ok) say(data.error ?? "failed");
      return res.ok;
    } catch {
      say("failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | File[] | null) {
    for (const file of Array.from(files ?? []).slice(0, MAX - pictures.length)) {
      if (file.size > MAX_BYTES) {
        say("too_big");
        continue;
      }
      const body = new FormData();
      body.set("set", setId);
      body.set("alt", defaultAlt);
      body.set("file", file);
      await send(body);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function addLink() {
    if (!link.trim()) return;
    if (!rights) {
      say("rights");
      return;
    }
    const body = new FormData();
    body.set("set", setId);
    body.set("alt", defaultAlt);
    body.set("url", link.trim());
    body.set("rights", "1");
    // What was typed stays when the link fails, so it can be corrected.
    if (await send(body)) {
      setLink("");
      setRights(false);
    }
  }

  async function patch(id: string, change: { move?: -1 | 1; alt?: string }) {
    const res = await fetch("/api/admin/offer-images", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ set: setId, id, ...change }),
    });
    const data = (await res.json().catch(() => ({}))) as { images?: Picture[]; error?: string };
    if (data.images) setPictures(data.images);
    if (!res.ok) say(data.error ?? "failed");
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/offer-images?set=${setId}&id=${id}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { images?: Picture[] };
    if (data.images) setPictures(data.images);
  }

  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (!full) void addFiles(e.dataTransfer.files);
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-offer-pictures={pictures.length}>
      <legend className="mb-1 text-[15px] font-semibold text-mist">
        {t("title", { count: pictures.length, max: MAX })}
      </legend>
      <input type="hidden" name="imageSetId" value={pictures.length ? setId : ""} />
      {pictures.length === 0 && catalogImage ? (
        <p className="flex items-center gap-3 text-sm text-stone">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small admin preview */}
          <img
            src={catalogImage}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 rounded-control bg-white object-contain"
          />
          {t("catalog")}
        </p>
      ) : null}
      {pictures.length ? (
        <ol className="flex flex-col gap-3" aria-label={t("list")}>
          {pictures.map((p, i) => (
            <li
              key={p.id}
              className="flex flex-wrap items-start gap-3 rounded-panel-lg border-[1.5px] border-line-25 p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Trilio's own stored copy */}
              <img
                src={p.src}
                alt=""
                width={72}
                height={72}
                className="h-[72px] w-[72px] rounded-control bg-white object-contain"
              />
              <div className="flex min-w-0 flex-1 basis-[180px] flex-col gap-2">
                <span className="text-sm text-stone">{i === 0 ? t("main") : t("extra", { n: i + 1 })}</span>
                <label className={labelClass}>
                  {t("alt")}
                  <input
                    defaultValue={p.alt}
                    required
                    maxLength={200}
                    onBlur={(e) => {
                      if (e.currentTarget.value.trim() !== p.alt)
                        void patch(p.id, { alt: e.currentTarget.value });
                    }}
                    className={inputClass}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => patch(p.id, { move: -1 })}
                  >
                    {t("earlier")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={i === pictures.length - 1}
                    onClick={() => patch(p.id, { move: 1 })}
                  >
                    {t("later")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => remove(p.id)}>
                    {t("remove")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {!full ? (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            className={`flex min-w-0 flex-col gap-2 rounded-panel-lg border-[1.5px] border-dashed p-4 ${
              over ? "border-lime" : "border-line-30"
            }`}
          >
            <label className={labelClass}>
              {t("fromComputer")}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(e) => addFiles(e.currentTarget.files)}
                className="min-h-11 w-full max-w-full min-w-0 text-[15px] text-mist file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-mist file:px-4 file:font-semibold file:text-night"
                data-testid="picture-file"
              />
            </label>
            <span className="text-sm text-stone">{t("fileHint")}</span>
          </div>
          <div className="flex flex-col gap-2 rounded-panel-lg border-[1.5px] border-line-25 p-4">
            <label className={labelClass}>
              {t("fromLink")}
              <input
                type="url"
                inputMode="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://"
                className={inputClass}
                data-testid="picture-link"
              />
            </label>
            <label className="flex min-h-11 items-center gap-3 text-[15px] text-mist">
              <input
                type="checkbox"
                checked={rights}
                onChange={(e) => setRights(e.target.checked)}
                className="h-5 w-5 accent-lime"
              />
              {t("rights")}
            </label>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !link.trim()}
                onClick={addLink}
              >
                {t("addLink")}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-stone">{t("full", { max: MAX })}</p>
      )}
      <p aria-live="polite" className="text-sm">
        {busy ? <span className="text-stone">{t("working")}</span> : null}
        {error ? (
          <span role="alert" className="font-semibold text-warning">
            {error}
          </span>
        ) : null}
      </p>
    </fieldset>
  );
}
