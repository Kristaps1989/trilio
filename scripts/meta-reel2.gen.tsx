import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import sharp from "sharp";
import { it } from "vitest";
import { brandFonts, Wordmark } from "@/services/ads/creatives";
import { OFFER_DISCOUNT_UP_TO_PCT, maxOfferSavingCents } from "@/domain/offers/discount";
import { formatEur } from "@/i18n/format";
import { Button, HEAD, LIME, MUTED, NIGHT, OUT, PICKS, STONE, Tile, photo, type Photos } from "./meta-ui";
import { Body, Ground, Line, SIZE, TopBar, clamp, ease, heroWidth, pop, type Shape } from "./reel-kit";
import { renderAudio, writeWav, type Cue } from "./reel-audio";

// R2, the request Reel (docs/META_ADS_PHASE1.md R2, owner 3 Nov 2026): how a
// shopper gets a lower price by leaving an e-mail, shown as the site does it.
// Six scenes, 20 s, with sound: the shop button → the question before the
// shop with "līdz −10 %" → the e-mail → "Pajautāts" → an example offer e-mail
// (labelled as an example) → trilio.lv. Every word on the sheet is the site's
// own copy. Run: npm run creatives:reel2 (REEL_SHAPES=story,feed,wide).

const FPS = Number(process.env.REEL_FPS ?? 30);
const DURATION = 20;
const NAME = "R2-pajauta-cenu";

const P = PICKS[0]!;
const PRICE_CENTS = 32400;
const SAVING_UP_TO = formatEur(maxOfferSavingCents(PRICE_CENTS));
/** The example offer: within the "up to", not at it. Shown as "Ilustratīvs piemērs". */
const OFFER = { price: "299 €", saving: "25 €" };
const EMAIL = "anna@epasts.lv";

const T = { shop: 0, sheet: 3.2, email: 7.6, done: 11.4, offer: 14.4, end: 17.4 } as const;
const TAP_SHOP = T.shop + 1.9;
const TYPE_FROM = T.email + 0.7;
const TYPE_EACH = 0.085;
const TAP_REQUEST = TYPE_FROM + EMAIL.length * TYPE_EACH + 0.45;

/** The sheet's width and its content scale (designed at 600 px, the phone sheet at poster size). */
const SHEET_W: Record<Shape, number> = { story: 880, feed: 760, wide: 740 };

/* ---------- the site's sheet, at poster scale ---------- */

function Sheet({ w, children, lift = 0 }: { w: number; children: ReactNode; lift?: number }) {
  const k = w / 600;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: w,
        gap: 16 * k,
        padding: `${30 * k}px ${30 * k}px ${32 * k}px`,
        borderRadius: 30 * k,
        background: "#FFFFFF",
        color: NIGHT,
        boxShadow: "0 40px 90px rgba(15,42,46,0.28)",
        transform: `translateY(${lift}px)`,
      }}
    >
      {children}
    </div>
  );
}

function SheetHead({ k }: { k: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 * k }}>
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 34 * k,
          lineHeight: 1.12,
          letterSpacing: "-0.02em",
        }}
      >
        Pirms pērc — pajautāsim lētāku cenu
      </div>
      <div style={{ display: "flex", fontSize: 21 * k, fontWeight: 700 }}>
        {`${P.name} · ${P.price} veikalā ${P.shop}`}
      </div>
    </div>
  );
}

function Strip({ k, p }: { k: number; p: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18 * k,
        padding: `${14 * k}px ${20 * k}px`,
        borderRadius: 16 * k,
        background: LIME,
        opacity: clamp(p),
        transform: `scale(${0.86 + 0.14 * p})`,
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 50 * k,
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {`līdz −${OFFER_DISCOUNT_UP_TO_PCT} %`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 20 * k, lineHeight: 1.3 }}>
        <div style={{ display: "flex" }}>šai precei tas ir līdz</div>
        <div style={{ display: "flex", gap: 6 * k }}>
          <div style={{ display: "flex", fontWeight: 800, fontSize: 22 * k }}>{SAVING_UP_TO}</div>
          <div style={{ display: "flex" }}>lētāk</div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  "Tu atstāj e-pastu.",
  "Mēs prasām izplatītājam cenu šai precei.",
  "Ja ir lētāk, saņem piedāvājumu. Pirkt nav obligāti.",
];

function Steps({ k, t, at }: { k: number; t: number; at: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 * k }}>
      {STEPS.map((s, i) => {
        const e = ease(t, at + i * 0.35, 0.45);
        return (
          <div
            key={s}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 14 * k,
              opacity: e,
              transform: `translateX(${(1 - e) * 40}px)`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexShrink: 0,
                width: 32 * k,
                height: 32 * k,
                borderRadius: 999,
                background: NIGHT,
                color: LIME,
                fontSize: 17 * k,
                fontWeight: 800,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {String(i + 1)}
            </div>
            <div style={{ display: "flex", fontSize: 22 * k, lineHeight: 1.32 }}>{s}</div>
          </div>
        );
      })}
    </div>
  );
}

function GoogleButton({ k }: { k: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14 * k,
        height: 62 * k,
        borderRadius: 14 * k,
        border: `${2 * k}px solid #6B7A7C`,
        background: "#FFFFFF",
        fontSize: 22 * k,
        fontWeight: 700,
      }}
    >
      <svg width={26 * k} height={26 * k} viewBox="0 0 48 48">
        <path
          fill="#FFC107"
          d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
        />
        <path
          fill="#FF3D00"
          d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
        />
        <path
          fill="#1976D2"
          d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
        />
      </svg>
      Turpināt ar Google
    </div>
  );
}

/** The e-mail step: Google, the field being typed into, the request button. */
function EmailStep({ k, typed, caret, press }: { k: number; typed: string; caret: boolean; press: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12 * k,
        padding: 18 * k,
        borderRadius: 18 * k,
        background: "#F2F4F3",
      }}
    >
      <GoogleButton k={k} />
      <div style={{ display: "flex", alignItems: "center", gap: 12 * k, fontSize: 18 * k, color: MUTED }}>
        <div style={{ display: "flex", flex: 1, height: 1.5 * k, background: "#D6DCDA" }} />
        vai ar e-pastu
        <div style={{ display: "flex", flex: 1, height: 1.5 * k, background: "#D6DCDA" }} />
      </div>
      <div style={{ display: "flex", fontSize: 19 * k, fontWeight: 700 }}>E-pasts</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 62 * k,
          padding: `0 ${16 * k}px`,
          borderRadius: 14 * k,
          border: `${2 * k}px solid ${typed ? NIGHT : "#6B7A7C"}`,
          background: "#FFFFFF",
          fontSize: 23 * k,
          color: typed ? NIGHT : "#98A3A4",
        }}
      >
        {typed || "tavs@epasts.lv"}
        {caret ? (
          <div
            style={{ display: "flex", width: 2.5 * k, height: 30 * k, marginLeft: 2 * k, background: NIGHT }}
          />
        ) : null}
      </div>
      <div style={{ display: "flex", transform: `scale(${press})` }}>
        <Button text="Pajautāt cenu" kind="lime" k={k * 0.95} />
      </div>
    </div>
  );
}

function Done({ k, p }: { k: number; p: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16 * k,
        padding: `${20 * k}px ${20 * k}px`,
        borderRadius: 18 * k,
        background: "#EAF5C8",
        opacity: clamp(p),
        transform: `scale(${0.9 + 0.1 * p})`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          width: 48 * k,
          height: 48 * k,
          borderRadius: 999,
          background: LIME,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width={28 * k}
          height={28 * k}
          viewBox="0 0 24 24"
          fill="none"
          stroke={NIGHT}
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      </div>
      <div style={{ display: "flex", fontSize: 23 * k, fontWeight: 700, lineHeight: 1.3 }}>
        Pajautāts. Meklējam lētāku cenu un uzrakstīsim.
      </div>
    </div>
  );
}

/** A phone's e-mail notification with the subject the offer e-mail really uses (offerEmail.subjectCheaper). */
function Notification({ w, p }: { w: number; p: number }) {
  const k = w / 600;
  return (
    <div
      style={{
        display: "flex",
        gap: 18 * k,
        width: w,
        padding: 22 * k,
        borderRadius: 28 * k,
        background: "rgba(255,255,255,0.97)",
        boxShadow: "0 30px 70px rgba(15,42,46,0.3)",
        opacity: clamp(p * 1.4),
        transform: `translateY(${(1 - p) * -160}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          width: 62 * k,
          height: 62 * k,
          borderRadius: 16 * k,
          background: LIME,
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 5 * k,
          padding: 14 * k,
        }}
      >
        <div style={{ display: "flex", width: 8 * k, height: 14 * k, borderRadius: 2, background: NIGHT }} />
        <div style={{ display: "flex", width: 8 * k, height: 28 * k, borderRadius: 2, background: NIGHT }} />
        <div style={{ display: "flex", width: 8 * k, height: 9 * k, borderRadius: 2, background: NIGHT }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 * k, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18 * k, color: MUTED }}>
          <div style={{ display: "flex", fontWeight: 700 }}>Trilio</div>
          <div style={{ display: "flex" }}>tagad</div>
        </div>
        <div style={{ display: "flex", fontSize: 22 * k, fontWeight: 800, color: NIGHT, lineHeight: 1.25 }}>
          {`${P.name} par ${OFFER.price}. Lētāk nekā veikalos.`}
        </div>
        <div style={{ display: "flex", fontSize: 20 * k, color: NIGHT, lineHeight: 1.3 }}>
          {`Tā pati prece. Par ${OFFER.saving} mazāk.`}
        </div>
      </div>
    </div>
  );
}

function PriceRow({ k, p }: { k: number; p: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        gap: 16 * k,
        opacity: clamp(p),
        transform: `translateY(${(1 - p) * 30}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: `${14 * k}px ${18 * k}px`,
          borderRadius: 16 * k,
          background: "#FFFFFF",
          border: "1.5px solid #D6DCDA",
          fontSize: 19 * k,
          color: MUTED,
        }}
      >
        {`Veikalā ${P.shop}`}
        <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 38 * k, color: NIGHT }}>
          {P.price}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: `${14 * k}px ${18 * k}px`,
          borderRadius: 16 * k,
          background: NIGHT,
          fontSize: 19 * k,
          color: "#CFE8A0",
        }}
      >
        Trilio piedāvājums
        <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 700, fontSize: 38 * k, color: LIME }}>
          {OFFER.price}
        </div>
      </div>
    </div>
  );
}

/** A tap: a lime ring that grows and fades over the element. */
function Ring({ x, bottom, w, h, p }: { x: number; bottom: number; w: number; h: number; p: number }) {
  if (p <= 0 || p >= 1) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        bottom,
        width: w,
        height: h,
        borderRadius: 999,
        border: `5px solid ${LIME}`,
        boxShadow: "0 0 0 6px rgba(15,42,46,0.08)",
        opacity: 1 - p,
        transform: `scale(${1 + p * 0.22})`,
      }}
    />
  );
}

function Note({ text, t, at }: { text: string; t: number; at: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: 26,
        color: MUTED,
        lineHeight: 1.35,
        opacity: ease(t, at, 0.5),
        maxWidth: 860,
      }}
    >
      {text}
    </div>
  );
}

function Head({ a, b, c, t, z }: { a: string; b: string; c?: string; t: number; z: (typeof SIZE)[Shape] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 30 }}>
      <Line text={a} size={z.head} color={NIGHT} t={t} at={0.05} />
      <Line text={b} size={z.head} color={NIGHT} t={t} at={0.2} />
      {c ? <Line text={c} size={z.head} color={NIGHT} t={t} at={0.35} /> : null}
    </div>
  );
}

/* ---------- scenes ---------- */

function Scene(t: number, z: (typeof SIZE)[Shape], ph: Photos, shape: Shape): ReactNode {
  const hw = heroWidth(z, shape);
  const sw = Math.min(SHEET_W[shape], hw);
  const k = sw / 600;

  if (t < T.sheet) {
    // The card, and a tap on the shop button.
    const s = t - T.shop;
    const e = pop(s, 0.1, 0.6);
    const tileW = Math.round(640 * z.k);
    const tk = 1.05 * z.k;
    const press = s >= TAP_SHOP && s < TAP_SHOP + 0.12 ? 0.97 : 1;
    const ring = clamp((s - TAP_SHOP) / 0.6);
    const out = ease(s, T.sheet - 0.35, 0.35);
    return (
      <Ground z={z} dark={false}>
        <TopBar dark={false} t={s} />
        <Body
          shape={shape}
          head={<Head a="Atradi īsto?" b="Spied „Pirkt”." t={s} z={z} />}
          hero={
            <div
              style={{
                display: "flex",
                width: hw,
                justifyContent: "center",
                position: "relative",
                opacity: 1 - out * 0.5,
              }}
            >
              <div
                style={{ display: "flex", opacity: clamp(e), transform: `scale(${(0.9 + 0.1 * e) * press})` }}
              >
                <Tile p={P} photos={ph} width={tileW} photoH={Math.round(300 * z.k)} k={tk} buttons />
              </div>
              <Ring
                x={hw / 2 - tileW / 2 + 26 * tk}
                bottom={(26 + 66 + 12) * tk}
                w={tileW - 52 * tk}
                h={66 * tk}
                p={ring}
              />
            </div>
          }
          foot={<Note text="Pirms pāriet uz veikalu, Trilio uzdod vienu jautājumu." t={s} at={0.9} />}
        />
      </Ground>
    );
  }

  if (t < T.email) {
    // The question before the shop, with the discount up front.
    const s = t - T.sheet;
    const up = ease(s, 0, 0.55);
    return (
      <Ground z={z} dark={false}>
        <TopBar dark={false} t={10} />
        <Body
          shape={shape}
          head={<Head a="Cena var būt" b={`līdz ${OFFER_DISCOUNT_UP_TO_PCT} % zemāka.`} t={s} z={z} />}
          hero={
            <div style={{ display: "flex", width: hw, justifyContent: "center" }}>
              <Sheet w={sw} lift={(1 - up) * 500}>
                <SheetHead k={k} />
                <Strip k={k} p={pop(s, 0.75, 0.5)} />
                <Steps k={k} t={s} at={1.5} />
              </Sheet>
            </div>
          }
          foot={<Note text="Pajautāsim izplatītājam cenu tieši šai precei." t={s} at={2.4} />}
        />
      </Ground>
    );
  }

  if (t < T.offer) {
    // The e-mail, the tap, then the site's own "Pajautāts".
    const s = t - T.email;
    const n = Math.max(0, Math.min(EMAIL.length, Math.floor((t - TYPE_FROM) / TYPE_EACH) + 1));
    const typed = t >= TYPE_FROM ? EMAIL.slice(0, n) : "";
    const done = t >= TAP_REQUEST + 0.15;
    const press = t >= TAP_REQUEST && t < TAP_REQUEST + 0.12 ? 0.97 : 1;
    const caret = !done && Math.floor(t * 2.2) % 2 === 0;
    const inDone = t >= T.done;
    const hs = inDone ? t - T.done : s;
    return (
      <Ground z={z} dark={false}>
        <TopBar dark={false} t={10} />
        <Body
          shape={shape}
          head={
            inDone ? (
              <Head a="Mēs sazināmies" b="ar izplatītāju." t={hs} z={z} />
            ) : (
              <Head a="Atstāj e-pastu." b="Vai turpini ar Google." t={hs} z={z} />
            )
          }
          hero={
            <div style={{ display: "flex", width: hw, justifyContent: "center" }}>
              <Sheet w={sw}>
                <SheetHead k={k} />
                <Strip k={k} p={1} />
                {done ? (
                  <Done k={k} p={pop(t - TAP_REQUEST, 0.15, 0.5)} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", opacity: ease(s, 0, 0.35) }}>
                    <EmailStep k={k} typed={typed} caret={caret} press={press} />
                  </div>
                )}
                {done ? (
                  <div style={{ display: "flex", opacity: ease(t, TAP_REQUEST + 0.5, 0.4) }}>
                    <Button text={`Uz ${P.shop}`} kind="dark" k={k * 0.95} />
                  </div>
                ) : null}
              </Sheet>
            </div>
          }
          foot={
            inDone ? (
              <Note
                text="Bez maksas. Ne biežāk kā reizi dienā, atteikties var jebkurā brīdī."
                t={hs}
                at={0.6}
              />
            ) : (
              <Note text="Tikai par šo preci. Pirkt nav obligāti." t={s} at={0.8} />
            )
          }
        />
      </Ground>
    );
  }

  if (t < T.end) {
    // An example of what arrives when the price can be lower.
    const s = t - T.offer;
    const out = ease(s, T.end - T.offer - 0.35, 0.35);
    return (
      <Ground z={z} dark={false}>
        <TopBar dark={false} t={10} />
        <Body
          shape={shape}
          head={<Head a="Ja atradīsim lētāk," b="atsūtīsim" c="piedāvājumu." t={s} z={z} />}
          hero={
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: hw,
                alignItems: "center",
                gap: 26 * k,
                opacity: 1 - out,
              }}
            >
              <Notification w={sw} p={pop(s, 0.35, 0.6)} />
              <div style={{ display: "flex", width: sw }}>
                <PriceRow k={k} p={ease(s, 1.1, 0.5)} />
              </div>
            </div>
          }
          foot={
            <Note
              text="Ilustratīvs piemērs. Ne katrai precei izdodas; ja ne, paziņosim, kad cena samazināsies."
              t={s}
              at={1.4}
            />
          }
        />
      </Ground>
    );
  }

  const s = t - T.end;
  const fade = 1 - ease(s, 0, 0.35);
  const logo = pop(s, 0.2, 0.7);
  return (
    <Ground z={z} dark>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 26 }}>
        <div style={{ display: "flex", opacity: clamp(logo), transform: `scale(${0.8 + 0.2 * logo})` }}>
          <Wordmark u={2.2} />
        </div>
        <Line text="trilio.lv" size={z.head} color={LIME} t={s} at={0.45} />
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: STONE,
            lineHeight: 1.35,
            opacity: ease(s, 0.7, 0.45),
            maxWidth: 860,
          }}
        >
          Pajautā cenu bez maksas. Pirkt nav obligāti.
        </div>
        <div style={{ display: "flex", width: 320, opacity: ease(s, 0.9, 0.45) }}>
          <Button text="Pajautāt cenu" kind="lime" k={1.1} />
        </div>
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: z.w,
          height: z.h,
          background: "#F4F7F3",
          opacity: fade,
        }}
      />
    </Ground>
  );
}

/* ---------- sound ---------- */

export function cues(): Cue[] {
  const c: Cue[] = [
    { at: TAP_SHOP, kind: "tap" },
    { at: T.sheet, kind: "whoosh" },
    { at: T.sheet + 0.8, kind: "pop" },
    { at: TAP_REQUEST, kind: "tap" },
    { at: TAP_REQUEST + 0.18, kind: "success" },
    { at: T.offer + 0.35, kind: "chime" },
    { at: T.end, kind: "riser" },
  ];
  for (let i = 0; i < EMAIL.length; i++) c.push({ at: TYPE_FROM + i * TYPE_EACH, kind: "type" });
  return c;
}

/* ---------- output ---------- */

it("renders the request Reel with sound", async () => {
  const ph: Photos = { [P.photo]: await photo(P.photo, 420) };
  const fonts = await brandFonts();
  const dir = path.join(OUT, NAME);
  mkdirSync(dir, { recursive: true });
  const wav = path.join(OUT, `.${NAME}.wav`);
  writeWav(
    wav,
    renderAudio(DURATION, cues(), {
      beatFrom: T.sheet,
      hatsFrom: T.email,
      clapsFrom: T.done,
      outroFrom: T.end,
    }),
  );
  const frames = Math.round(DURATION * FPS);
  const only = process.env.REEL_SHAPES?.split(",");
  for (const [shape, tag] of [
    ["story", "9x16_1080x1920"],
    ["feed", "4x5_1080x1350"],
    ["wide", "16x9_1920x1080"],
  ] as const) {
    if (only && !only.includes(shape)) continue;
    const z = SIZE[shape];
    const tmp = path.join(OUT, `.frames2-${shape}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      const png = Buffer.from(
        await new ImageResponse(
          <div style={{ display: "flex", width: z.w, height: z.h }}>{Scene(t, z, ph, shape)}</div>,
          { width: z.w, height: z.h, fonts },
        ).arrayBuffer(),
      );
      writeFileSync(path.join(tmp, `f${String(i).padStart(4, "0")}.png`), png);
      if (process.env.REEL_BOARD) {
        mkdirSync(path.join(OUT, ".board2"), { recursive: true });
        writeFileSync(
          path.join(OUT, ".board2", `${shape}-${String(i).padStart(4, "0")}.jpg`),
          await sharp(png).jpeg({ quality: 80 }).toBuffer(),
        );
      }
      if (i === Math.round(5.6 * FPS))
        writeFileSync(
          path.join(dir, `${NAME}_${tag}_cover.jpg`),
          await sharp(png).jpeg({ quality: 92 }).toBuffer(),
        );
    }
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-framerate",
        String(FPS),
        "-i",
        path.join(tmp, "f%04d.png"),
        "-i",
        wav,
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-crf",
        "20",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-af",
        "loudnorm=I=-14:TP=-1.5:LRA=11",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-shortest",
        "-movflags",
        "+faststart",
        path.join(dir, `${NAME}_${tag}.mp4`),
      ],
      { stdio: "ignore" },
    );
    rmSync(tmp, { recursive: true, force: true });
  }
  rmSync(wav, { force: true });
}, 3_600_000);
