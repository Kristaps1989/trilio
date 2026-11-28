import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import sounds from "../../../data/social-sounds.json";
import type { Db } from "@/db/client";
import { socialImages, socialPosts } from "@/db/schema";
import type { PostCard } from "@/domain/social/captions";
import {
  MAX_REEL_SLIDES,
  REEL_FPS,
  reelFilter,
  reelPlan,
  reelTimeline,
  timelineFilter,
} from "@/domain/social/reel";
import { reelScript, type ReelScript } from "@/domain/social/reel-script";
import { rigaDayOf } from "@/domain/social/schedule";
import { reelPhotos, renderReelPicture } from "./reel-render";
import { renderPostJpeg, slidesOf } from "./render";

// A generated Reel (docs/SOCIAL_PLAN.md §14): the post's own slides drawn upright (9:16) and
// joined into a short video with ffmpeg, with recorded clicks and sweeps. Made once per card
// and stored beside the post's pictures, so Meta's fetch never waits for it.

const run = promisify(execFile);
type PostRow = typeof socialPosts.$inferSelect;
const SHAPE = "video";

/** ffmpeg on this machine: FFMPEG_PATH, else "ffmpeg" on the PATH. Null when there is none. */
let found: string | null | undefined;
export async function ffmpegPath(): Promise<string | null> {
  if (found !== undefined) return found;
  const candidate = process.env.FFMPEG_PATH || "ffmpeg";
  try {
    await run(candidate, ["-version"], { timeout: 10_000 });
    found = candidate;
  } catch {
    found = null;
  }
  return found;
}
/** Tests: look for ffmpeg again. */
export function resetFfmpeg(): void {
  found = undefined;
}

/** A sound effect fetched to a file; null when it cannot be had (the video is made without it). */
async function sound(dir: string, name: keyof typeof SOUNDS): Promise<string | null> {
  try {
    const res = await fetch(SOUNDS[name], { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const file = path.join(dir, `${name}.mp3`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}
const SOUNDS = { sweep: sounds.sweep, pop: sounds.pop, click: sounds.click };

/**
 * The card's slides as one MP4 (H.264, AAC, 1080 × 1920, 30 fps). Null without ffmpeg.
 * `withSound: false` skips the fetches (tests, or a network without the sound library).
 */
export async function renderReel(card: PostCard, opts: { withSound?: boolean } = {}): Promise<Buffer | null> {
  const ffmpeg = await ffmpegPath();
  if (!ffmpeg) return null;
  const script = scriptOf(card);
  if (script) return renderScenes(ffmpeg, script, opts);
  const slides = slidesOf(card).slice(0, MAX_REEL_SLIDES);
  const plan = reelPlan(slides.length);
  const dir = await mkdtemp(path.join(tmpdir(), "trilio-reel-"));
  try {
    const each = plan.slides === 1 ? plan.total : plan.starts[1]! + 0.35;
    const args: string[] = ["-loglevel", "error", "-y"];
    for (let i = 0; i < slides.length; i++) {
      const file = path.join(dir, `s${i}.jpg`);
      // One at a time: drawing is heavy.
      // Drawn as a single picture each: a video has no "swipe on" cue and no slide counter.
      await writeFile(file, await renderPostJpeg(slides[i]!, 0, 1, "story"));
      args.push("-loop", "1", "-framerate", String(REEL_FPS), "-t", String(each), "-i", file);
    }
    args.push("-f", "lavfi", "-t", String(plan.total), "-i", "anullsrc=r=44100:cl=stereo");
    const audio: { input: number; at: number; volume: number }[] = [];
    if (opts.withSound !== false) {
      const files = new Map<string, string | null>();
      for (const s of plan.sounds) {
        if (!files.has(s.sound)) files.set(s.sound, await sound(dir, s.sound));
        const file = files.get(s.sound);
        if (!file) continue;
        args.push("-i", file);
        audio.push({ input: slides.length + 1 + audio.length, at: s.at, volume: s.volume });
      }
    }
    const out = path.join(dir, "reel.mp4");
    args.push(
      "-filter_complex",
      reelFilter(plan, audio),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      String(plan.total),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(REEL_FPS),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      out,
    );
    await run(ffmpeg, args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * The Reel's own scenes: the card's, else made from the picks a stored Reel post was composed
 * from (owner, 28 Nov 2026: products, their analysis and price changes, not the carousel's slides).
 */
export function scriptOf(card: PostCard, now = new Date()): ReelScript | null {
  if (card.reel) return card.reel;
  const facts = (card as PostCard & { facts?: { kind: string; of?: { kind: string } } }).facts;
  if (facts?.kind === "reel" && facts.of?.kind === "picks")
    return reelScript(facts.of as Parameters<typeof reelScript>[0], rigaDayOf(now));
  return null;
}

/** Sound effects fetched for the plan's cues, as ffmpeg inputs after `first`. */
async function soundInputs(
  dir: string,
  cues: { sound: "pop" | "sweep" | "click"; at: number; volume: number }[],
  first: number,
  args: string[],
): Promise<{ input: number; at: number; volume: number }[]> {
  const audio: { input: number; at: number; volume: number }[] = [];
  const files = new Map<string, string | null>();
  for (const s of cues) {
    if (!files.has(s.sound)) files.set(s.sound, await sound(dir, s.sound));
    const file = files.get(s.sound);
    if (!file) continue;
    args.push("-i", file);
    audio.push({ input: first + audio.length, at: s.at, volume: s.volume });
  }
  return audio;
}

const ENCODE = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(REEL_FPS),
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-movflags",
  "+faststart",
];

/** The scene Reel: each scene's pictures, pushed in slowly, built with fades and joined with slides. */
async function renderScenes(
  ffmpeg: string,
  script: ReelScript,
  opts: { withSound?: boolean },
): Promise<Buffer> {
  const t = reelTimeline(script.scenes);
  const dir = await mkdtemp(path.join(tmpdir(), "trilio-reel-"));
  try {
    const photos = await reelPhotos(script);
    const args: string[] = ["-loglevel", "error", "-y"];
    for (let i = 0; i < t.clips.length; i++) {
      const c = t.clips[i]!;
      const file = path.join(dir, `c${i}.jpg`);
      // One at a time: drawing is heavy.
      await writeFile(file, await renderReelPicture(script, c.scene, c.step, photos));
      args.push("-loop", "1", "-framerate", String(REEL_FPS), "-t", String(c.seconds), "-i", file);
    }
    args.push("-f", "lavfi", "-t", String(t.total), "-i", "anullsrc=r=44100:cl=stereo");
    const audio = opts.withSound === false ? [] : await soundInputs(dir, t.sounds, t.clips.length + 1, args);
    const out = path.join(dir, "reel.mp4");
    args.push(
      "-filter_complex",
      timelineFilter(t, audio),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      String(t.total),
      ...ENCODE,
      out,
    );
    await run(ffmpeg, args, { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Whether this post's video is one Trilio makes itself (its address is this post's own). */
export const generatedVideoPath = (postId: string) => `/api/social/${postId}/video.mp4`;
export const hasGeneratedVideo = (p: Pick<PostRow, "id" | "videoUrl">) =>
  !!p.videoUrl && p.videoUrl.endsWith(generatedVideoPath(p.id));

/**
 * The post's video: the stored copy for this card, else made now and stored. Null when the
 * post has no generated video or this machine has no ffmpeg.
 */
export async function postVideo(database: Db, p: PostRow): Promise<Buffer | null> {
  if (!hasGeneratedVideo(p)) return null;
  const cardHash = hash(JSON.stringify(p.card));
  const [stored] = await database
    .select({ bytes: socialImages.jpeg, cardHash: socialImages.cardHash })
    .from(socialImages)
    .where(and(eq(socialImages.postId, p.id), eq(socialImages.n, 0), eq(socialImages.shape, SHAPE)))
    .catch(() => []);
  if (stored && stored.cardHash === cardHash) return Buffer.from(stored.bytes);
  const video = await renderReel(p.card as unknown as PostCard);
  if (!video) return null;
  await database
    .insert(socialImages)
    .values({ postId: p.id, n: 0, shape: SHAPE, cardHash, jpeg: video })
    .onConflictDoUpdate({
      target: [socialImages.postId, socialImages.n, socialImages.shape],
      set: { cardHash, jpeg: video, createdAt: new Date() },
    })
    .catch((err) => console.error("social video: not stored", (err as Error).message));
  return video;
}
