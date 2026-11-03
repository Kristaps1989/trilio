import { writeFileSync } from "node:fs";

// The Reel's sound, synthesised here so it is ours to use (no licence, no
// library): a light I–V–vi–IV bed at 100 BPM that builds with the story, and
// interface sounds on the picture's own events (a tap, typing, the sheet, the
// discount, the request, the e-mail). Stereo, 48 kHz, written as 16-bit WAV;
// the encoder normalises loudness for Meta (about −14 LUFS).

export const RATE = 48_000;

export type CueKind = "tap" | "type" | "whoosh" | "pop" | "success" | "chime" | "riser";
export type Cue = { at: number; kind: CueKind };

/** When the bed changes: the beat comes in, the hats, the claps, and where it resolves. */
export type Arrangement = { beatFrom: number; hatsFrom: number; clapsFrom: number; outroFrom: number };

const TAU = Math.PI * 2;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Deterministic noise, so every render sounds the same. */
function noise(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

class Mix {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(seconds: number) {
    const n = Math.ceil(seconds * RATE);
    this.l = new Float32Array(n);
    this.r = new Float32Array(n);
  }
  get length() {
    return this.l.length;
  }
  /** Adds `fn(t)` from `at` for `dur` seconds, panned (−1 left … 1 right). */
  add(at: number, dur: number, fn: (t: number) => number, pan = 0) {
    const start = Math.max(0, Math.round(at * RATE));
    const end = Math.min(this.length, Math.round((at + dur) * RATE));
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = start; i < end; i++) {
      const v = fn((i - start) / RATE);
      this.l[i]! += v * gl;
      this.r[i]! += v * gr;
    }
  }
}

/* ---------- the bed ---------- */

// C – G – Am – F, one chord a bar; root, then the voicing.
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 36, tones: [60, 64, 67, 71] }, // Cmaj7
  { root: 43, tones: [55, 59, 62, 67] }, // G
  { root: 45, tones: [57, 60, 64, 67] }, // Am7
  { root: 41, tones: [53, 57, 60, 64] }, // Fmaj7
];

function bed(mix: Mix, seconds: number, bpm: number, a: Arrangement) {
  const beat = 60 / bpm;
  const bar = beat * 4;
  const hiss = noise(7);
  for (let b = 0; b * bar < seconds; b++) {
    const at = b * bar;
    const c = CHORDS[b % CHORDS.length]!;
    const outro = at >= a.outroFrom;
    const chord = outro ? CHORDS[0]! : c;
    const len = outro ? seconds - at : bar + 0.35;
    // Pad: each tone twice, slightly detuned and spread, slow in and out.
    chord.tones.forEach((n, j) => {
      const f = midi(n);
      for (const [d, pan] of [
        [0.9985, -0.45],
        [1.0015, 0.45],
      ] as const)
        mix.add(
          at,
          len,
          (t) => {
            const env = Math.min(1, t / 0.45) * Math.min(1, (len - t) / 0.4);
            const trem = 0.85 + 0.15 * Math.sin(TAU * 0.4 * (at + t) + j);
            return 0.018 * env * trem * Math.sin(TAU * f * d * t);
          },
          pan,
        );
    });
    if (outro) break;
    // Bass on beats 1 and 3, once the story starts moving.
    if (at >= a.beatFrom - 0.01)
      for (const k of [0, 2]) {
        const f = midi(c.root);
        mix.add(at + k * beat, beat * 1.6, (t) => 0.11 * Math.exp(-t * 2.6) * Math.sin(TAU * f * t));
      }
    // Pluck arpeggio in eighths, an octave up, alternating sides.
    for (let e = 0; e < 8; e++) {
      const t0 = at + e * (beat / 2);
      if (t0 < a.beatFrom - 0.01) continue;
      const n = c.tones[[0, 1, 2, 3, 2, 1, 2, 3][e]!]! + 12;
      const f = midi(n);
      mix.add(
        t0,
        0.6,
        (t) => 0.045 * Math.exp(-t * 7) * (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t)),
        e % 2 ? 0.35 : -0.35,
      );
    }
    for (let k = 0; k < 4; k++) {
      const t0 = at + k * beat;
      // Kick on 1 and 3.
      if (t0 >= a.beatFrom - 0.01 && k % 2 === 0)
        mix.add(t0, 0.35, (t) => {
          const f = 48 + 70 * Math.exp(-t * 30);
          return 0.32 * Math.exp(-t * 11) * Math.sin(TAU * f * t);
        });
      // Soft clap on 2 and 4.
      if (t0 >= a.clapsFrom - 0.01 && k % 2 === 1) {
        let prev = 0;
        mix.add(t0, 0.2, (t) => {
          const x = hiss();
          const hp = x - prev;
          prev = x;
          return 0.05 * Math.exp(-t * 22) * hp;
        });
      }
      // Hats on the off-beats.
      if (t0 >= a.hatsFrom - 0.01) {
        let prev = 0;
        mix.add(
          t0 + beat / 2,
          0.08,
          (t) => {
            const x = hiss();
            const hp = x - prev;
            prev = x;
            return 0.03 * Math.exp(-t * 70) * hp;
          },
          0.25,
        );
      }
    }
  }
}

/* ---------- interface sounds ---------- */

function bell(mix: Mix, at: number, f: number, gain: number, pan = 0) {
  mix.add(
    at,
    1.4,
    (t) =>
      gain *
      Math.exp(-t * 4.2) *
      (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t * 6)),
    pan,
  );
}

function cue(mix: Mix, c: Cue, i: number) {
  const n = noise(101 + i * 17);
  switch (c.kind) {
    case "tap":
      mix.add(c.at, 0.12, (t) => {
        const click = t < 0.004 ? n() * 0.6 * (1 - t / 0.004) : 0;
        return 0.22 * (click + Math.exp(-t * 60) * Math.sin(TAU * 1500 * t));
      });
      return;
    case "type": {
      const f = 2600 + (600 * ((i * 37) % 7)) / 7;
      let prev = 0;
      mix.add(
        c.at,
        0.05,
        (t) => {
          const x = n();
          const hp = x - prev;
          prev = x;
          return 0.07 * Math.exp(-t * 140) * (hp + 0.6 * Math.sin(TAU * f * t));
        },
        0.15,
      );
      return;
    }
    case "whoosh": {
      let y = 0;
      const dur = 0.6;
      mix.add(c.at, dur, (t) => {
        const x = t / dur;
        const cut = 300 + 3800 * Math.sin(Math.PI * Math.min(1, x * 1.2));
        const a = 1 - Math.exp((-TAU * cut) / RATE);
        y += a * (n() - y);
        return 0.22 * Math.sin(Math.PI * x) * y;
      });
      return;
    }
    case "pop":
      mix.add(c.at, 0.3, (t) => {
        const f = 620 + 520 * Math.min(1, t / 0.07);
        return 0.2 * Math.exp(-t * 16) * Math.sin(TAU * f * t);
      });
      bell(mix, c.at + 0.05, midi(84), 0.06);
      return;
    case "success":
      bell(mix, c.at, midi(79), 0.12, -0.2);
      bell(mix, c.at + 0.1, midi(84), 0.12, 0.2);
      return;
    case "chime":
      bell(mix, c.at, midi(84), 0.11, -0.3);
      bell(mix, c.at + 0.09, midi(88), 0.11, 0);
      bell(mix, c.at + 0.18, midi(91), 0.11, 0.3);
      return;
    case "riser": {
      let y = 0;
      const dur = 1.1;
      mix.add(c.at - dur, dur, (t) => {
        const x = t / dur;
        const cut = 200 + 5000 * x * x;
        const a = 1 - Math.exp((-TAU * cut) / RATE);
        y += a * (n() - y);
        return 0.12 * x * x * y;
      });
      return;
    }
  }
}

/** The whole track: bed plus cues, faded in and out, peak-normalised. */
export function renderAudio(seconds: number, cues: Cue[], a: Arrangement, bpm = 100): Mix {
  const mix = new Mix(seconds);
  bed(mix, seconds, bpm, a);
  cues.forEach((c, i) => cue(mix, c, i));
  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix.l[i]!), Math.abs(mix.r[i]!));
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < mix.length; i++) {
    const t = i / RATE;
    const fade = Math.min(1, t / 0.25) * Math.min(1, (seconds - t) / 1.2);
    mix.l[i]! *= g * fade;
    mix.r[i]! *= g * fade;
  }
  return mix;
}

export function writeWav(file: string, mix: Mix) {
  const n = mix.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix.l[i]!)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix.r[i]!)) * 32767), 46 + i * 4);
  }
  writeFileSync(file, buf);
}
