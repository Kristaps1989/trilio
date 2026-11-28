import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { composePost, type PostFacts } from "@/domain/social/captions";
import { reelTimeline } from "@/domain/social/reel";
import { reelScript } from "@/domain/social/reel-script";
import {
  ffmpegPath,
  generatedVideoPath,
  hasGeneratedVideo,
  renderReel,
  resetFfmpeg,
  scriptOf,
} from "./video";

// A generated Reel (docs/SOCIAL_PLAN.md §14). The video itself needs ffmpeg on the machine;
// where there is none, the service says so and makes nothing, and that is tested either way.

const picks = [
  {
    name: "Electrolux EEA27200L",
    priceCents: 37900,
    shop: "Veikals A",
    imageUrl: "/sample/fridge-builtin.png",
  },
  { name: "Bosch SMV2ITX22E", priceCents: 52999, shop: "Veikals B", imageUrl: "/sample/kettle-steel.png" },
  { name: "AEG FSE73727P", priceCents: 79900, shop: "Veikals C" },
];
const facts: PostFacts = {
  kind: "picks",
  subcategoryId: "dish",
  category: "Trauku mazgājamās mašīnas",
  picks,
  path: "/",
  questions: [{ title: "Cik plata?", options: ["45 cm", "60 cm"] }],
};
const card = composePost(facts, { postId: "s", baseUrl: "https://trilio.lv", design: "collage" }).card;

let hasFfmpeg = true;
try {
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}

describe("generated Reel", () => {
  const saved = process.env.FFMPEG_PATH;
  afterEach(() => {
    if (saved === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = saved;
    resetFfmpeg();
  });

  it("knows which posts have a video of its own making", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(generatedVideoPath(id)).toBe(`/api/social/${id}/video.mp4`);
    expect(hasGeneratedVideo({ id, videoUrl: `https://trilio.lv/api/social/${id}/video.mp4` })).toBe(true);
    // The owner's own video, and a post with none.
    expect(hasGeneratedVideo({ id, videoUrl: "https://cdn.example/reel.mp4" })).toBe(false);
    expect(hasGeneratedVideo({ id, videoUrl: null })).toBe(false);
  });

  it("without ffmpeg it makes nothing and says so, instead of failing", async () => {
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
    resetFfmpeg();
    expect(await ffmpegPath()).toBeNull();
    expect(await renderReel(card, { withSound: false })).toBeNull();
  });

  it.skipIf(!hasFfmpeg)(
    "joins the post's slides into an upright MP4 with a sound track",
    async () => {
      const video = await renderReel(card, { withSound: false });
      expect(video).not.toBeNull();
      // An MP4 starts with its "ftyp" box.
      expect(video!.subarray(4, 8).toString("latin1")).toBe("ftyp");
      const dir = mkdtempSync(path.join(tmpdir(), "trilio-reel-test-"));
      try {
        const file = path.join(dir, "v.mp4");
        writeFileSync(file, video!);
        const probe = (entries: string) =>
          execFileSync(
            (process.env.FFMPEG_PATH || "ffmpeg").replace(/ffmpeg$/, "ffprobe"),
            ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", file],
            { encoding: "utf8" },
          );
        const streams = probe("stream=codec_name,width,height");
        expect(streams).toContain("h264,1080,1920");
        expect(streams).toContain("aac");
        // Six slides (the most a Reel takes) of 2.8 s overlapping by 0.35 s.
        expect(Number(probe("format=duration"))).toBeCloseTo(15.05, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it("a Reel post about picks gets the scene Reel; any other card plays its slides", () => {
    expect(scriptOf(card)).toBeNull();
    const stored = { ...card, facts: { kind: "reel", caption: "x", videoUrl: "v", path: "/", of: facts } };
    expect(scriptOf(stored as typeof card)?.scenes.map((s) => s.kind)).toEqual([
      "hook",
      "product",
      "product",
      "product",
      "compare",
      "cta",
    ]);
  });

  it.skipIf(!hasFfmpeg)(
    "draws the scene Reel: three products with their price lines, as long as its timeline",
    async () => {
      if (facts.kind !== "picks") throw new Error();
      const days = Array.from({ length: 12 }, (_, i) => ({
        day: `2026-11-${String(16 + i).padStart(2, "0")}`,
        priceCents: i < 6 ? 41900 : 39900,
      }));
      const script = reelScript(
        { ...facts, picks: picks.map((p) => ({ ...p, history: days })) },
        "2026-11-28",
      );
      const video = await renderReel({ ...card, reel: script }, { withSound: false });
      const dir = mkdtempSync(path.join(tmpdir(), "trilio-reel-test-"));
      try {
        const file = path.join(dir, "v.mp4");
        writeFileSync(file, video!);
        const probe = (entries: string) =>
          execFileSync(
            (process.env.FFMPEG_PATH || "ffmpeg").replace(/ffmpeg$/, "ffprobe"),
            ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", file],
            { encoding: "utf8" },
          );
        expect(probe("stream=codec_name,width,height")).toContain("h264,1080,1920");
        expect(Number(probe("format=duration"))).toBeCloseTo(reelTimeline(script.scenes).total, 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
