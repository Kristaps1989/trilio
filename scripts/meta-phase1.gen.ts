import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import type { PhoneScreen, PostCard } from "@/domain/social/captions";
import { getSubcategory } from "@/domain/questions/catalog";
import { renderPostJpeg, type Shape } from "@/services/social/render";

// The Meta Phase 1 creative set (docs/META_ADS_PHASE1.md): every still ad in
// 4:5 (Feed), 9:16 (Stories, Reels) and 1:1 (right column, Search), the
// carousel's square cards, and two short Reels built from keyframes with
// ffmpeg. Run: npm run creatives:meta  → assets/ads/meta-phase1/.
//
// Honesty (CLAUDE.md, BRAND.md): no prices (they change daily), no product
// names, no "lētākais", the offer always "ja varēsim lētāk"; the phone shows
// the site's own questions and buttons.

type Slide = Omit<PostCard, "slides">;

const OUT = path.join(process.cwd(), "assets/ads/meta-phase1");
const CATS = ["fridge", "washer", "dish", "vacuum"];
const NOTE = "Meklējam labāku cenu. Ja atradīsim, atsūtīsim piedāvājumu.";

const card = (over: Partial<Slide> & Pick<Slide, "layout">): Slide => ({
  chip: "",
  title: "",
  lines: [],
  ...over,
});

const requestPhone: PhoneScreen = {
  kind: "card",
  name: "Izvēlētais modelis",
  shop: "Partnera veikalā",
  price: "",
  buttons: ["Pirkt veikalā", "Pieprasīt labāku cenu"],
  note: NOTE,
  // A drawing, not a product photo: no model, no price is claimed.
  image: "/sample/fridge-builtin.png",
};

/** The flow's first plain questions, worded exactly as the site asks them. */
function questionsOf(subcategoryId: string, n = 2): PhoneScreen {
  const sub = getSubcategory(subcategoryId)!;
  return {
    kind: "questions",
    questions: sub.questions
      .filter((q) => q.stage === "flow" && !q.showIf && (q.type === "single" || q.type === "multi"))
      .slice(0, n)
      .map((q) => ({ title: q.title, options: q.options.map((o) => o.label) })),
  };
}

const washerQuestions = questionsOf("washer");

const closing = (headline: string, accent: string, sub: string): Slide =>
  card({ layout: "closing", headline, headlineAccent: accent, sub, icons: CATS, buttons: ["Sākt izvēli"] });

/** Still ads: one idea each (Andromeda reads distinct concepts, not colour variants). */
const STILLS: Record<string, Slide> = {
  "A1-dazi-jautajumi": closing(
    "Daži jautājumi.",
    "Trīs ieteikumi.",
    "Pērc uzreiz vai pieprasi labāku cenu. Padoms bez maksas.",
  ),
  "A2-cenu-var-pajautat": card({
    layout: "phone",
    eyebrow: "Pieprasīt labāku cenu",
    headline: "Cenu var pajautāt.",
    sub: "Pajautāsim izplatītājam. Ja varēsim lētāk, atsūtīsim piedāvājumu.",
    phone: requestPhone,
  }),
  "A3-tris-kas-der": card({
    layout: "cover",
    eyebrow: "Ledusskapji",
    headline: "Daudz modeļu.",
    headlineAccent: "Trīs, kas der.",
    sub: "Brīvi stāvošs vai iebūvējams, cik durvju, cik cilvēku.",
    hero: "fridge",
    rows: [
      { n: "01", label: "Daži jautājumi" },
      { n: "02", label: "Trīs piemērotākie varianti" },
      { n: "03", label: "Pērc uzreiz vai pieprasi labāku cenu" },
    ],
  }),
  "A4-vela-dazos-jautajumos": card({
    layout: "phone",
    eyebrow: "Veļas mašīnas",
    headline: "Daži jautājumi.",
    headlineAccent: "Trīs piemērotākās.",
    sub: "No Latvijas partneru veikaliem.",
    phone: washerQuestions,
  }),
  "A5-seciba-bez-komisijas": card({
    layout: "statement",
    eyebrow: "Kā mēs izvēlamies",
    headline: "Secību nenosaka veikalu komisija.",
    sub: "Ieteikumu secību nosaka tas, kas atbilst atbildēm.",
    hero: "dish",
  }),
};

/** The carousel: one square card per category, then the request. */
const CAROUSEL: Record<string, Slide> = {
  "1-ledusskapji": card({
    layout: "phone",
    eyebrow: "Daži jautājumi · 3 ieteikumi",
    headline: "Ledusskapji",
    phone: questionsOf("fridge"),
  }),
  "2-velas-masinas": card({
    layout: "phone",
    eyebrow: "Daži jautājumi · 3 ieteikumi",
    headline: "Veļas mašīnas",
    phone: questionsOf("washer"),
  }),
  "3-trauku-mazgajamas": card({
    layout: "phone",
    eyebrow: "Daži jautājumi · 3 ieteikumi",
    headline: "Trauku mazgājamās mašīnas",
    phone: questionsOf("dish"),
  }),
  "4-putekslsuceji": card({
    layout: "phone",
    eyebrow: "Daži jautājumi · 3 ieteikumi",
    headline: "Putekļsūcēji",
    phone: questionsOf("vacuum"),
  }),
  "5-pieprasi-labaku-cenu": closing(
    "Pieprasi",
    "labāku cenu.",
    "Ja varēsim lētāk, atsūtīsim piedāvājumu. Ja ne, paziņosim, kad cena kritīs.",
  ),
};

/** Reels: keyframes with their seconds on screen. */
const REELS: Record<string, { slide: Slide; seconds: number }[]> = {
  "R1-vela-3-soli": [
    {
      slide: card({
        layout: "statement",
        eyebrow: "Veļas mašīnas",
        headline: "Kuru veļas mašīnu izvēlēties?",
        sub: "Atbilde dažos jautājumos.",
        hero: "washer",
      }),
      seconds: 2.4,
    },
    {
      slide: card({
        layout: "phone",
        eyebrow: "1. solis",
        headline: "Daži jautājumi.",
        sub: "Tikai tie, kas izšķir izvēli.",
        phone: washerQuestions,
      }),
      seconds: 3.4,
    },
    {
      slide: card({
        layout: "phone",
        eyebrow: "2. solis",
        headline: "Trīs ieteikumi.",
        headlineAccent: "Pērc vai pieprasi labāku cenu.",
        // A washer reel: no fridge drawing on the card.
        phone: { ...requestPhone, image: undefined },
      }),
      seconds: 3.6,
    },
    {
      slide: card({
        layout: "statement",
        eyebrow: "Pieprasīt labāku cenu",
        headline: "Pajautāsim izplatītājam. Ja varēsim lētāk, atsūtīsim piedāvājumu.",
        sub: "Ja ne, paziņosim, kad cena veikalos kritīs.",
      }),
      seconds: 3.2,
    },
    {
      slide: closing("Daži jautājumi.", "Trīs ieteikumi.", "Pērc uzreiz vai pieprasi labāku cenu."),
      seconds: 2.8,
    },
  ],
  "R2-cenu-var-pajautat": [
    {
      slide: card({
        layout: "statement",
        eyebrow: "Trilio",
        headline: "Cenu var pajautāt.",
        sub: "Tā pati prece. Iespējams, lētāk.",
      }),
      seconds: 2.2,
    },
    {
      slide: card({
        layout: "phone",
        eyebrow: "Pie katra ieteikuma",
        headline: "Viena poga.",
        sub: "„Pieprasīt labāku cenu”",
        phone: requestPhone,
      }),
      seconds: 3.2,
    },
    {
      slide: card({
        layout: "statement",
        eyebrow: "Pieprasīt labāku cenu",
        headline: "Trilio pajautā izplatītājam.",
        sub: "Pieprasījums bez maksas.",
      }),
      seconds: 2.6,
    },
    {
      slide: card({
        layout: "statement",
        eyebrow: "Ja izdodas",
        headline: "Atsūtām piedāvājumu uz e-pastu.",
        sub: "Ja ne, paziņojam, kad cena veikalos kritīs.",
      }),
      seconds: 3,
    },
    {
      slide: closing("Daži jautājumi.", "Trīs ieteikumi.", "Pērc uzreiz vai pieprasi labāku cenu."),
      seconds: 2.8,
    },
  ],
};

async function still(file: string, slide: Slide, shape: Shape): Promise<void> {
  writeFileSync(file, await renderPostJpeg(slide, 0, 1, shape));
}

/** Keyframes → an H.264 MP4 with a slow push-in on each frame and short cross-fades. */
function reel(frames: { file: string; seconds: number }[], out: string, w: number, h: number): void {
  const fade = 0.35;
  const fps = 30;
  const args: string[] = ["-y"];
  // One still per input: zoompan turns it into exactly d frames (a looped input would multiply them).
  for (const f of frames) args.push("-i", f.file);
  const parts: string[] = [];
  frames.forEach((f, i) => {
    const n = Math.round((f.seconds + fade) * fps);
    parts.push(
      `[${i}:v]scale=${Math.round(w * 1.5)}:${Math.round(h * 1.5)},zoompan=z='min(zoom+0.0006,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${w}x${h}:fps=${fps},format=yuv420p,setsar=1[v${i}]`,
    );
  });
  let last = "v0";
  let offset = 0;
  for (let i = 1; i < frames.length; i++) {
    offset += frames[i - 1]!.seconds;
    const label = `x${i}`;
    parts.push(
      `[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}[${label}]`,
    );
    last = label;
  }
  args.push(
    "-filter_complex",
    parts.join(";"),
    "-map",
    `[${last}]`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-crf",
    "21",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-r",
    String(fps),
    out,
  );
  execFileSync("ffmpeg", args, { stdio: "ignore" });
}

it("renders the Meta Phase 1 creative set", async () => {
  rmSync(OUT, { recursive: true, force: true });
  for (const [name, slide] of Object.entries(STILLS)) {
    const dir = path.join(OUT, name);
    mkdirSync(dir, { recursive: true });
    await still(path.join(dir, `${name}_4x5_1080x1350.jpg`), slide, "portrait");
    await still(path.join(dir, `${name}_9x16_1080x1920.jpg`), slide, "story");
    await still(path.join(dir, `${name}_1x1_1080x1080.jpg`), slide, "square");
  }
  const cdir = path.join(OUT, "A6-karuselis");
  mkdirSync(cdir, { recursive: true });
  for (const [name, slide] of Object.entries(CAROUSEL))
    await still(path.join(cdir, `A6-karte-${name}_1x1_1080x1080.jpg`), slide, "square");
  const tmp = path.join(OUT, ".frames");
  for (const [name, frames] of Object.entries(REELS)) {
    const dir = path.join(OUT, name);
    mkdirSync(dir, { recursive: true });
    mkdirSync(tmp, { recursive: true });
    for (const [shape, w, h, tag] of [
      ["story", 1080, 1920, "9x16_1080x1920"],
      ["portrait", 1080, 1350, "4x5_1080x1350"],
    ] as const) {
      const files: { file: string; seconds: number }[] = [];
      for (const [i, f] of frames.entries()) {
        const file = path.join(tmp, `${name}-${shape}-${i}.jpg`);
        await still(file, f.slide, shape);
        files.push({ file, seconds: f.seconds });
      }
      reel(files, path.join(dir, `${name}_${tag}.mp4`), w, h);
      // The first frame doubles as the video's cover image in Ads Manager.
      writeFileSync(
        path.join(dir, `${name}_${tag}_cover.jpg`),
        await renderPostJpeg(frames[0]!.slide, 0, 1, shape),
      );
    }
  }
  rmSync(tmp, { recursive: true, force: true });
}, 600_000);
