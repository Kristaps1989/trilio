// The timing of a generated Reel (docs/SOCIAL_PLAN.md §14): a post's slides, upright, one after
// another with a short slide between them. Pure: the video service turns this into ffmpeg's terms.

/** Seconds a slide is on screen, and how long two slides overlap while one pushes the other out. */
export const SLIDE_SECONDS = 2.8;
export const CROSS_SECONDS = 0.35;
/** Instagram wants a Reel of at least 3 s; more than six slides is longer than people watch. */
export const MAX_REEL_SLIDES = 6;
export const REEL_FPS = 30;

export type ReelPlan = {
  slides: number;
  /** When each slide starts, in seconds. */
  starts: number[];
  total: number;
  /** Sounds on the timeline: a pop as the first slide lands, a sweep at each change, a click on the last. */
  sounds: { at: number; sound: "pop" | "sweep" | "click"; volume: number }[];
};

export function reelPlan(slideCount: number): ReelPlan {
  const slides = Math.max(1, Math.min(slideCount, MAX_REEL_SLIDES));
  // One slide alone is held longer, so the video is not a flash.
  const each = slides === 1 ? 5 : SLIDE_SECONDS;
  const starts = Array.from({ length: slides }, (_, i) => +(i * (each - CROSS_SECONDS)).toFixed(3));
  const total = +(starts[slides - 1]! + each).toFixed(3);
  const sounds: ReelPlan["sounds"] = [{ at: 0.2, sound: "pop", volume: 0.35 }];
  for (let i = 1; i < slides; i++)
    sounds.push({ at: +(starts[i]! - 0.05).toFixed(3), sound: "sweep", volume: 0.22 });
  if (slides > 1) sounds.push({ at: +(starts[slides - 1]! + 1.2).toFixed(3), sound: "click", volume: 0.5 });
  return { slides, starts, total, sounds };
}

/**
 * ffmpeg's filter graph for the plan: every still gets a slow push-in, the slides are chained
 * with a slide-up, and the sounds that were fetched (by input index) are laid on a silent track.
 * Inputs: the slides first (0…n-1), then the silent track (n), then the sounds in `audio` order.
 */
export function reelFilter(plan: ReelPlan, audio: { input: number; at: number; volume: number }[]): string {
  const n = plan.slides;
  const each = n === 1 ? plan.total : SLIDE_SECONDS;
  const frames = Math.round(each * REEL_FPS);
  const parts: string[] = [];
  for (let i = 0; i < n; i++)
    parts.push(
      `[${i}:v]scale=1620:2880,zoompan=z='1+0.05*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${REEL_FPS},format=yuv420p,setsar=1[s${i}]`,
    );
  let cur = "[s0]";
  for (let i = 1; i < n; i++) {
    parts.push(
      `${cur}[s${i}]xfade=transition=slideup:duration=${CROSS_SECONDS}:offset=${plan.starts[i]}[x${i}]`,
    );
    cur = `[x${i}]`;
  }
  const mix = [`[${n}:a]`];
  audio.forEach((a, k) => {
    parts.push(
      `[${a.input}:a]silenceremove=start_periods=1:start_threshold=-42dB,aformat=sample_rates=44100:channel_layouts=stereo,volume=${a.volume},adelay=${Math.round(a.at * 1000)}:all=1[a${k}]`,
    );
    mix.push(`[a${k}]`);
  });
  parts.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0:duration=first,alimiter=limit=0.9[aout]`);
  // The last video label is renamed so the caller maps one fixed name.
  parts.push(`${cur}null[vout]`);
  return parts.join(";");
}
