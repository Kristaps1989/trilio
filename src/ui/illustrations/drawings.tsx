import type { ReactElement } from "react";

// Picture-card line drawings. One shared style: single-colour line art on a
// 96 × 96 box, the <svg> wrapper (Illustration.tsx) sets stroke, width 2 and
// round caps. Only the appliance is drawn, plus the furniture it fits into
// where that matters (cabinet column, worktop, niche). No people, no text: the
// card label carries the numbers.
//
// Size sets (fridge-h*, freezer-h*, niche-n*, washer-d*, dish-w*, dish-h*,
// micro-n*) share one scale and one floor within each set, so the sizes can be
// compared side by side; a thin dimension bracket marks the measured size.

export type Drawing = ReactElement; // the inner SVG content

const fine = { strokeWidth: 1.5 } as const;
const tint = { fill: "currentColor", fillOpacity: 0.15 } as const;
const tintOnly = { fill: "currentColor", fillOpacity: 0.15, stroke: "none" } as const;
const dashed = { strokeDasharray: "3 3", strokeWidth: 1.5 } as const;

/** Round to 0.1 px so path data stays short. */
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Shared fragments

function dot(cx: number, cy: number, r = 1.1) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
}

function snowflake(cx: number, cy: number, r: number) {
  const dx = r * 0.866;
  const dy = r / 2;
  return (
    <path
      {...fine}
      d={`M${cx} ${cy - r}V${cy + r}M${cx - dx} ${cy - dy}L${cx + dx} ${cy + dy}M${cx - dx} ${cy + dy}L${cx + dx} ${cy - dy}`}
    />
  );
}

/** Floor line at y = 88. */
function floor(x1 = 10, x2 = 86) {
  return <path {...fine} d={`M${x1} 88H${x2}`} />;
}

/** Vertical dimension bracket (line with end ticks). */
function vDim(x: number, y1: number, y2: number) {
  return <path {...fine} d={`M${x} ${y1}V${y2}M${x - 2.5} ${y1}H${x + 2.5}M${x - 2.5} ${y2}H${x + 2.5}`} />;
}

/** Horizontal dimension bracket (line with end ticks). */
function hDim(y: number, x1: number, x2: number) {
  return <path {...fine} d={`M${x1} ${y}H${x2}M${x1} ${y - 2.5}V${y + 2.5}M${x2} ${y - 2.5}V${y + 2.5}`} />;
}

/** Base cabinet from `top` down to the floor, with a small handle near the top. */
function baseCabinet(x: number, w: number, top: number, handleRight = true) {
  const hx = handleRight ? x + w - 4 : x + 4;
  return (
    <>
      <rect x={x} y={top} width={w} height={88 - top} rx={1} />
      <path {...fine} d={`M${hx} ${top + 4}V${top + 11}`} />
    </>
  );
}

/** Kitchen run: worktop (y 40–44) over two base cabinets and a 36 px bay at x 30–66. */
function kitchenRow(bay: ReactElement) {
  return (
    <>
      <rect x={6} y={40} width={84} height={4} rx={1} />
      {baseCabinet(6, 24, 44, true)}
      {baseCabinet(66, 24, 44, false)}
      {bay}
    </>
  );
}

/** Integrated appliance hidden behind a furniture front in the kitchen bay. */
function hiddenInBay(top: number, extra?: ReactElement) {
  return (
    <>
      <rect x={30} y={top} width={36} height={88 - top} rx={1} />
      <path d={`M42 ${top + 5}H54`} />
      <rect {...dashed} x={33} y={top + 10} width={30} height={75 - top} rx={1} />
      {extra}
    </>
  );
}

/** Tall kitchen column (x 40–76) next to a worktop and base cabinet, with a hidden appliance. */
function tallColumn(inside: ReactElement) {
  return (
    <>
      <rect x={8} y={50} width={32} height={4} rx={1} />
      {baseCabinet(8, 32, 54, false)}
      <rect x={40} y={6} width={36} height={82} rx={1} />
      <path d="M40 58H76" />
      <path {...fine} d="M72.5 46V53M72.5 63V70" />
      <rect {...dashed} x={44} y={10} width={24} height={74} rx={1.5} />
      {inside}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fridges and freezers

/** Size sets for fridges and freezers: 0.4 px per cm, floor at y = 88. */
const FRIDGE_CM = 0.4;
const fridgeTop = (cm: number) => r1(88 - cm * FRIDGE_CM);

/** Fridge front from `y` to the floor; `split` is the fridge / freezer join. */
function fridge(x: number, w: number, y: number, split?: number) {
  const hx = x + w - 3.5;
  const h = 88 - y;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={2} />
      {split ? (
        <>
          <path d={`M${x} ${split}H${x + w}`} />
          <path
            d={`M${hx} ${r1(split - Math.min(16, (split - y) * 0.4))}V${split - 4}M${hx} ${split + 4}V${r1(split + Math.min(10, (88 - split) * 0.4))}`}
          />
        </>
      ) : (
        <path d={`M${hx} ${r1(y + h * 0.12)}V${r1(y + h * 0.4)}`} />
      )}
    </>
  );
}

/** Upright freezer: one door with drawer lines behind it. */
function freezer(x: number, w: number, y: number) {
  const n = Math.max(3, Math.round((88 - y) / 12));
  const step = (88 - y) / n;
  const lines: string[] = [];
  for (let i = 1; i < n; i++) lines.push(`M${x + 3} ${r1(y + i * step)}H${x + w - 7}`);
  return (
    <>
      <rect x={x} y={y} width={w} height={88 - y} rx={2} />
      <path {...fine} d={lines.join("")} />
      <path d={`M${x + w - 3.5} ${y + 4}V${r1(y + Math.min(14, step * 1.2))}`} />
    </>
  );
}

/** One member of a fridge / freezer size set: floor, appliance, height bracket. */
function sizeSet(body: ReactElement, y: number) {
  return (
    <>
      {floor(16, 80)}
      {body}
      {vDim(68, y, 88)}
    </>
  );
}

/** Built-in niche size set: same column for all, niche drawn at 0.38 px per cm. */
function nicheColumn(cm: number) {
  const y = r1(82 - cm * 0.38);
  return (
    <>
      <rect x={28} y={6} width={36} height={82} rx={1} />
      <rect {...tint} {...fine} x={31} y={y} width={30} height={r1(82 - y)} rx={1} />
      {y > 24 && <path {...fine} d={`M60 ${r1(y - 11)}V${r1(y - 4)}`} />}
      {vDim(72, y, 82)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Washers, dryers, dishwashers

/** Front-loading machine front (washer or dryer), top-left at (x, y). */
function washerBody(x: number, y: number, w: number, h: number, inside: "drum" | "air") {
  const p = r1(h * 0.16);
  const cx = r1(x + w / 2);
  const cy = r1(y + p + (h - p) / 2);
  const r = r1(Math.min(w, h - p) * 0.36);
  const a = r1(r * 0.45);
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={2} />
      <path {...fine} d={`M${x} ${y + p}H${x + w}`} />
      <rect {...fine} x={x + 4} y={r1(y + p / 2 - 1.5)} width={r1(w * 0.25)} height={3} rx={0.5} />
      <circle {...fine} cx={x + w - 6} cy={r1(y + p / 2)} r={1.6} />
      <circle cx={cx} cy={cy} r={r} />
      {inside === "drum" ? (
        <circle {...fine} cx={cx} cy={cy} r={r1(r * 0.62)} />
      ) : (
        <path
          {...fine}
          d={`M${cx - a} ${r1(cy - a * 0.45)}q${a / 2} ${-a / 2} ${a} 0t${a} 0M${cx - a} ${r1(cy + a * 0.55)}q${a / 2} ${-a / 2} ${a} 0t${a} 0`}
        />
      )}
    </>
  );
}

/** Washer seen from the side at 0.8 px per cm, 85 cm tall, with a depth bracket. */
function washerSide(depthCm: number) {
  const d = r1(depthCm * 0.8);
  const x1 = r1(51 - d / 2);
  const x2 = r1(x1 + d);
  return (
    <>
      <rect x={x1} y={12} width={d} height={68} rx={2} />
      <path {...fine} d={`M${x1} 22H${x2}`} />
      <path d={`M${x1} 36Q${x1 - 7} 50 ${x1} 64`} />
      <path {...fine} d={`M${x1 + 4} 80V83M${x2 - 4} 80V83`} />
      {hDim(89, x1, x2)}
    </>
  );
}

/** Dishwasher front at 0.8 px per cm, 85 cm tall, with a width bracket. */
function dishFront(widthCm: number) {
  const w = r1(widthCm * 0.8);
  const x = r1(48 - w / 2);
  return (
    <>
      <rect x={x} y={12} width={w} height={68} rx={2} />
      <path {...fine} d={`M${x} 21H${x + w}`} />
      <rect {...fine} x={x + 4} y={15} width={8} height={3} rx={0.5} />
      <path d={`M${r1(48 - w * 0.18)} 27H${r1(48 + w * 0.18)}`} />
      <path {...fine} d={`M${x + 3} 75H${x + w - 3}`} />
      {hDim(88, x, x + w)}
    </>
  );
}

/** Under-counter niche of height h px between two base cabinets, with a height bracket. */
function underCounter(h: number) {
  const y = 88 - h;
  return (
    <>
      <rect x={6} y={y - 4} width={70} height={4} rx={1} />
      {baseCabinet(6, 16, y, true)}
      {baseCabinet(60, 16, y, false)}
      <rect {...tintOnly} x={22} y={y} width={38} height={h} />
      {floor(22, 60)}
      {vDim(84, y, 88)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Microwave / oven parts

function microwave(x: number, y: number, w: number, h: number) {
  const pad = h < 20 ? 3 : 5;
  const kx = x + w - 14;
  const keys: ReactElement[] = [];
  for (let ky = y + pad + 9; ky < y + h - 3; ky += 5) {
    keys.push(
      <g key={ky}>
        {dot(kx + 2, ky)}
        {dot(kx + 7, ky)}
      </g>,
    );
  }
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={3} />
      <rect x={x + pad} y={y + pad} width={w - 19 - pad} height={h - 2 * pad} rx={2} />
      <path {...fine} d={`M${kx - 4} ${y}V${y + h}`} />
      <rect {...fine} x={kx} y={y + pad} width={9} height={4} rx={1} />
      {keys}
    </>
  );
}

/** Tall cabinet with a microwave niche of nicheH px (0.8 px per cm) starting at y = 24. */
function microColumn(nicheH: number, bracket: boolean) {
  const bottom = 24 + nicheH;
  return (
    <>
      <rect x={22} y={6} width={48} height={82} rx={1} />
      <path d={`M22 24H70M22 ${bottom}H70`} />
      <path {...fine} d={`M64 13V19M64 ${bottom + 5}V${bottom + 11}`} />
      {microwave(25, 26.5, 42, nicheH - 5)}
      {bracket && vDim(78, 24, bottom)}
    </>
  );
}

function builtInOven(top: number) {
  return (
    <>
      <rect x={18} y={top} width={60} height={88 - top} rx={2} />
      <path {...fine} d={`M18 ${top + 8}H78`} />
      <circle {...fine} cx={25} cy={top + 4} r={2} />
      <circle {...fine} cx={71} cy={top + 4} r={2} />
      <rect {...fine} x={42} y={top + 2.5} width={12} height={3} rx={1} />
      <path d={`M26 ${top + 13}H70`} />
      <rect {...tint} {...fine} x={26} y={top + 18} width={44} height={88 - top - 24} rx={2} />
      <path {...fine} d={`M86 ${top}V88M84 ${top}H88M84 88H88`} />
    </>
  );
}

function miniOven(x: number, y: number, w: number, h: number, inside?: ReactElement) {
  const kx = x + w - 9;
  return (
    <>
      <rect x={x} y={y} width={w} height={h - 3} rx={3} />
      <path {...fine} d={`M${x + 5} ${y + h - 3}V${y + h}M${x + w - 5} ${y + h - 3}V${y + h}`} />
      <rect x={x + 5} y={y + 6} width={w - 22} height={h - 15} rx={2} />
      <path {...fine} d={`M${kx - 4} ${y}V${y + h - 3}`} />
      <circle {...fine} cx={kx + 1.5} cy={y + 10} r={2.5} />
      <circle {...fine} cx={kx + 1.5} cy={y + 20} r={2.5} />
      {inside}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hob / hood parts

function hobRing(cx: number, cy: number, r: number, filled = false) {
  return filled ? <circle {...tint} cx={cx} cy={cy} r={r} /> : <circle cx={cx} cy={cy} r={r} />;
}

function hobGlass() {
  return (
    <>
      <rect x={12} y={20} width={72} height={60} rx={3} />
      {dot(44, 75)}
      {dot(48, 75)}
      {dot(52, 75)}
    </>
  );
}

function coilWaves(cx: number, cy: number) {
  return (
    <path {...fine} d={`M${cx - 5} ${cy - 1.5}q2.5 -2.5 5 0t5 0M${cx - 5} ${cy + 2.5}q2.5 -2.5 5 0t5 0`} />
  );
}

function hobWidth(x1: number, x2: number, rings: ReactElement) {
  return (
    <>
      <rect x={x1} y={22} width={x2 - x1} height={54} rx={3} />
      {rings}
      <path {...fine} d={`M${x1} 84H${x2}M${x1} 81V87M${x2} 81V87`} />
    </>
  );
}

function chimneyHood(left: number, right: number) {
  return (
    <>
      <rect x={42} y={6} width={12} height={30} rx={1} />
      <path d={`M${left} 50L${Math.min(left + 10, 36)} 36H${Math.max(right - 10, 60)}L${right} 50`} />
      <rect x={left} y={50} width={right - left} height={5} rx={1.5} />
      <rect x={24} y={80} width={48} height={3} rx={1} />
      <path {...fine} d="M32 80V78H44V80M52 80V77H64V80" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Misc parts

function robotDisc(extra?: ReactElement) {
  return (
    <>
      <ellipse cx={48} cy={70} rx={36} ry={12} />
      <path d="M12 70V76A36 12 0 0 0 84 76V70" />
      <ellipse {...fine} cx={48} cy={66} rx={8} ry={3} />
      <path {...fine} d="M48 63V60M20 75A30 10 0 0 0 44 81.8" />
      {extra}
    </>
  );
}

function toaster(x1: number, x2: number, slots: number) {
  const slices: ReactElement[] = [];
  const inner = x2 - x1 - 12;
  const sw = Math.min(12, inner / slots - 2);
  const gap = (inner - sw * slots) / (slots - 1);
  for (let i = 0; i < slots; i++) {
    const sx = x1 + 6 + i * (sw + gap);
    slices.push(
      <path
        key={i}
        d={`M${sx} 50V41Q${sx - 1.5} 34 ${sx + sw / 2} 34Q${sx + sw + 1.5} 34 ${sx + sw} 41V50`}
        {...tint}
        {...fine}
      />,
    );
  }
  return (
    <>
      {slices}
      <rect x={x1} y={48} width={x2 - x1} height={36} rx={8} />
      <path {...fine} d={`M${x1 + 4} 84V88M${x2 - 4} 84V88`} />
      <path d={`M${x2} 58H${x2 + 4}`} />
      <circle {...fine} cx={(x1 + x2) / 2} cy={70} r={3} />
    </>
  );
}

function dehydrator(trays: number, trayH: number) {
  const top = 80 - trays * trayH;
  const lines = [];
  for (let i = 1; i < trays; i++) lines.push(`M24 ${top + i * trayH}H72`);
  return (
    <>
      <rect x={20} y={80} width={56} height={8} rx={2} />
      <rect x={24} y={top} width={48} height={80 - top} rx={1} />
      <path {...fine} d={lines.join("")} />
      <path d={`M24 ${top}Q24 ${top - 6} 32 ${top - 6}H64Q72 ${top - 6} 72 ${top}`} />
      <path d={`M44 ${top - 6}V${top - 9}H52V${top - 6}`} />
    </>
  );
}

// ---------------------------------------------------------------------------

export const DRAWINGS: Record<string, Drawing> = {
  // ---- Fridges --------------------------------------------------------------
  "fridge-free": (
    <g>
      {floor()}
      {fridge(31, 34, 14, 60)}
    </g>
  ),
  "fridge-builtin": <g>{tallColumn(<path {...dashed} d="M44 62H68" />)}</g>,

  // Size set: same scale and floor (0.4 px per cm).
  "fridge-h54": <g>{sizeSet(fridge(38, 20, fridgeTop(54)), fridgeTop(54))}</g>,
  "fridge-h85": (
    <g>
      <path d="M14 51H61" />
      {sizeSet(fridge(36, 24, fridgeTop(85)), fridgeTop(85))}
    </g>
  ),
  "fridge-h140": <g>{sizeSet(fridge(36, 24, fridgeTop(140)), fridgeTop(140))}</g>,
  "fridge-h175": <g>{sizeSet(fridge(36, 24, fridgeTop(175), 60), fridgeTop(175))}</g>,
  "fridge-h195": <g>{sizeSet(fridge(36, 24, fridgeTop(195), 58), fridgeTop(195))}</g>,

  // Door layout: same height, the doors and width differ.
  "fridge-one": <g>{fridge(31, 34, 14)}</g>,
  "fridge-two": <g>{fridge(31, 34, 14, 60)}</g>,
  "fridge-multi": (
    <g>
      <rect x={16} y={14} width={64} height={74} rx={2} />
      <path d="M48 14V62M16 62H80" />
      <path d="M44 34V54M52 34V54M40 68H56" />
    </g>
  ),

  // Built-in niche height: same column, niche at one shared scale.
  "niche-n88": <g>{nicheColumn(88)}</g>,
  "niche-n122": <g>{nicheColumn(122)}</g>,
  "niche-n158": <g>{nicheColumn(158)}</g>,
  "niche-n178": <g>{nicheColumn(178)}</g>,
  "niche-n194": <g>{nicheColumn(194)}</g>,

  // ---- Built-in fridge hinges (side view) ---------------------------------
  "hinge-fixed": (
    <g>
      <rect {...tint} x={30} y={12} width={10} height={72} rx={2} />
      <rect x={52} y={8} width={6} height={80} rx={1} />
      <rect {...fine} x={40} y={22} width={12} height={5} rx={1} />
      <rect {...fine} x={40} y={46} width={12} height={5} rx={1} />
      <rect {...fine} x={40} y={70} width={12} height={5} rx={1} />
      {dot(43, 24.5)}
      {dot(49, 24.5)}
      {dot(43, 48.5)}
      {dot(49, 48.5)}
      {dot(43, 72.5)}
      {dot(49, 72.5)}
    </g>
  ),
  "hinge-sliding": (
    <g>
      <rect {...tint} x={30} y={12} width={10} height={72} rx={2} />
      <rect x={52} y={8} width={6} height={80} rx={1} />
      <rect {...fine} x={47} y={16} width={5} height={24} rx={1} />
      <rect {...fine} x={47} y={56} width={5} height={24} rx={1} />
      <path d="M40 28H49.5M40 68H49.5" />
      <rect {...tint} {...fine} x={46} y={25} width={7} height={6} rx={1} />
      <rect {...tint} {...fine} x={46} y={65} width={7} height={6} rx={1} />
      <path {...fine} d="M66 22V34M63.5 24.5L66 22L68.5 24.5M63.5 31.5L66 34L68.5 31.5" />
      <path {...fine} d="M66 62V74M63.5 64.5L66 62L68.5 64.5M63.5 71.5L66 74L68.5 71.5" />
    </g>
  ),

  // ---- Freezers -------------------------------------------------------------
  "freezer-upright": (
    <g>
      {freezer(30, 36, 12)}
      {snowflake(46, 18.5, 4)}
    </g>
  ),
  "freezer-chest": (
    <g>
      <rect x={14} y={46} width={68} height={42} rx={2} />
      <path d="M14 55H82" />
      <path d="M40 60H56" />
      {snowflake(48, 74, 6)}
    </g>
  ),
  "freezer-builtin": <g>{tallColumn(snowflake(56, 24, 5))}</g>,
  "freezer-h85": <g>{sizeSet(freezer(36, 24, fridgeTop(85)), fridgeTop(85))}</g>,
  "freezer-h145": <g>{sizeSet(freezer(36, 24, fridgeTop(145)), fridgeTop(145))}</g>,
  "freezer-h185": <g>{sizeSet(freezer(36, 24, fridgeTop(185)), fridgeTop(185))}</g>,

  // ---- Washers and dryers ---------------------------------------------------
  "washer-front": <g>{washerBody(28, 30, 40, 56, "drum")}</g>,
  "washer-combo": <g>{washerBody(28, 30, 40, 56, "air")}</g>,
  "washer-top": (
    <g>
      <path d="M33 30L37 18H59L63 30" />
      <ellipse {...fine} cx={48} cy={24} rx={8} ry={2.5} />
      <rect x={33} y={30} width={30} height={58} rx={2} />
      <path {...fine} d="M33 38H63" />
      <circle {...fine} cx={57} cy={34} r={1.6} />
      <path {...fine} d="M37 82H59" />
    </g>
  ),
  "washer-d40": <g>{washerSide(40)}</g>,
  "washer-d45": <g>{washerSide(47)}</g>,
  "washer-d55": <g>{washerSide(58)}</g>,
  "place-free": (
    <g>
      {floor()}
      {washerBody(28, 32, 40, 56, "drum")}
    </g>
  ),
  "place-under": (
    <g>
      <rect x={6} y={40} width={84} height={4} rx={1} />
      {baseCabinet(6, 36, 44, true)}
      {washerBody(48, 44, 36, 44, "drum")}
    </g>
  ),
  "place-builtin": <g>{kitchenRow(hiddenInBay(44, <circle {...dashed} cx={48} cy={70} r={9} />))}</g>,
  "dryer-side": (
    <g>
      {washerBody(8, 35, 38, 53, "drum")}
      {washerBody(50, 35, 38, 53, "air")}
    </g>
  ),
  "dryer-stack": (
    <g>
      {washerBody(33, 6, 30, 41, "air")}
      {washerBody(33, 47, 30, 41, "drum")}
    </g>
  ),
  dryer: (
    <g>
      <rect x={28} y={30} width={40} height={56} rx={2} />
      <path {...fine} d="M28 39H68" />
      <path {...fine} d="M32 32.5V36.5M35 32.5V36.5M38 32.5V36.5M41 32.5V36.5" />
      <circle {...fine} cx={62} cy={34.5} r={1.6} />
      <circle cx={48} cy={62.5} r={14.4} />
      <path
        {...fine}
        d="M42 57.5q1.5 -2 3 0t3 0t3 0t3 0M42 62.5q1.5 -2 3 0t3 0t3 0t3 0M42 67.5q1.5 -2 3 0t3 0t3 0t3 0"
      />
    </g>
  ),

  // ---- Dishwashers ----------------------------------------------------------
  "dish-free": (
    <g>
      {floor()}
      <rect x={28} y={32} width={40} height={56} rx={2} />
      <path {...fine} d="M28 36H68M28 44H68" />
      <rect {...fine} x={32} y={38.5} width={8} height={3} rx={0.5} />
      {dot(56, 40)}
      {dot(60, 40)}
      {dot(64, 40)}
      <path d="M41 50H55" />
      <path {...fine} d="M31 83H65" />
    </g>
  ),
  "dish-builtin": (
    <g>
      {kitchenRow(
        <>
          <rect x={30} y={44} width={36} height={44} rx={1} />
          <path {...fine} d="M30 51H66" />
          <rect {...fine} x={33} y={46} width={8} height={3} rx={0.5} />
          <path d="M42 56H54" />
          <path {...fine} d="M33 84H63" />
        </>,
      )}
    </g>
  ),
  "dish-full": <g>{kitchenRow(hiddenInBay(44))}</g>,
  "dish-semi": (
    <g>
      {kitchenRow(
        <>
          <rect {...tint} x={30} y={44} width={36} height={8} rx={1} />
          <rect {...fine} x={33} y={46.5} width={8} height={3} rx={0.5} />
          {dot(54, 48)}
          {dot(58, 48)}
          {dot(62, 48)}
          {hiddenInBay(52)}
        </>,
      )}
    </g>
  ),
  "dish-tabletop": (
    <g>
      <rect x={8} y={56} width={80} height={4} rx={1} />
      <rect x={10} y={60} width={76} height={28} rx={1} />
      <path d="M48 60V88" />
      <path {...fine} d="M44 64V70M52 64V70" />
      <rect x={30} y={26} width={36} height={30} rx={2} />
      <path {...fine} d="M30 33H66" />
      <rect {...fine} x={33} y={28} width={7} height={3} rx={0.5} />
      <path d="M42 39H54" />
    </g>
  ),
  "dish-w45": <g>{dishFront(45)}</g>,
  "dish-w60": <g>{dishFront(60)}</g>,
  // Under-counter niche height; the 4 cm gap is drawn a little larger so it reads.
  "dish-h82": <g>{underCounter(46)}</g>,
  "dish-h86": <g>{underCounter(56)}</g>,

  // ---- Hobs ---------------------------------------------------------------
  "hob-ceramic": (
    <g>
      {hobGlass()}
      {hobRing(31, 38, 11, true)}
      {hobRing(65, 37, 8)}
      {hobRing(31, 64, 8)}
      {hobRing(65, 61, 11)}
    </g>
  ),
  "hob-induction": (
    <g>
      {hobGlass()}
      {hobRing(31, 38, 11)}
      {hobRing(65, 37, 8)}
      {hobRing(31, 64, 8)}
      {hobRing(65, 61, 11)}
      {coilWaves(31, 38)}
      {coilWaves(65, 61)}
    </g>
  ),
  "hob-gas": (
    <g>
      <rect x={12} y={20} width={72} height={60} rx={3} />
      {[
        [31, 38],
        [65, 38],
        [31, 62],
        [65, 62],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={5} />
          {dot(cx, cy, 1.6)}
          <path
            {...fine}
            d={`M${cx - 11} ${cy}H${cx - 7}M${cx + 7} ${cy}H${cx + 11}M${cx} ${cy - 11}V${cy - 7}M${cx} ${cy + 7}V${cy + 11}`}
          />
        </g>
      ))}
      <circle {...fine} cx={44} cy={75.5} r={1.8} />
      <circle {...fine} cx={52} cy={75.5} r={1.8} />
    </g>
  ),
  "hob-cooker": (
    <g>
      <path {...fine} d="M28 30V27H44V30M52 30V27H68V30" />
      <rect x={24} y={30} width={48} height={58} rx={2} />
      <path {...fine} d="M24 40H72" />
      <circle {...fine} cx={31} cy={35} r={2} />
      <circle {...fine} cx={39} cy={35} r={2} />
      <circle {...fine} cx={57} cy={35} r={2} />
      <circle {...fine} cx={65} cy={35} r={2} />
      <path d="M31 45H65" />
      <rect {...tint} {...fine} x={31} y={50} width={34} height={26} rx={2} />
      <path {...fine} d="M24 82H72" />
    </g>
  ),
  "hob-w30": (
    <g>
      {hobWidth(
        34,
        62,
        <>
          {hobRing(48, 37, 9)}
          {hobRing(48, 62, 8)}
        </>,
      )}
    </g>
  ),
  "hob-w60": (
    <g>
      {hobWidth(
        20,
        76,
        <>
          {hobRing(34, 37, 9)}
          {hobRing(62, 37, 8)}
          {hobRing(34, 62, 8)}
          {hobRing(62, 61, 9)}
        </>,
      )}
    </g>
  ),
  "hob-w80": (
    <g>
      {hobWidth(
        10,
        86,
        <>
          {hobRing(23, 37, 8)}
          {hobRing(23, 62, 8)}
          {hobRing(73, 37, 8)}
          {hobRing(73, 62, 8)}
          {hobRing(48, 49, 11)}
        </>,
      )}
    </g>
  ),

  // ---- Hoods --------------------------------------------------------------
  "hood-wall": <g>{chimneyHood(24, 72)}</g>,
  "hood-w50": <g>{chimneyHood(28, 68)}</g>,
  "hood-w60": <g>{chimneyHood(24, 72)}</g>,
  "hood-w90": <g>{chimneyHood(12, 84)}</g>,
  "hood-island": (
    <g>
      <path d="M8 6H88" />
      <rect x={43} y={6} width={10} height={28} rx={1} />
      <path d="M26 48L37 34H59L70 48" />
      <rect x={26} y={48} width={44} height={5} rx={1.5} />
      <rect x={18} y={72} width={60} height={16} rx={1} />
      <path {...fine} d="M32 72V70H44V72M52 72V69H64V72" />
    </g>
  ),
  "hood-builtin": (
    <g>
      <rect x={16} y={8} width={64} height={36} rx={1} />
      <path d="M48 8V44" />
      <path {...fine} d="M44 36V40M52 36V40" />
      <rect {...tint} x={30} y={44} width={36} height={4} rx={1} />
      <rect x={28} y={48} width={40} height={4} rx={1.5} />
      <rect x={24} y={80} width={48} height={3} rx={1} />
      <path {...fine} d="M32 80V78H44V80M52 80V77H64V80" />
    </g>
  ),

  // ---- Ovens --------------------------------------------------------------
  "oven-std": <g>{builtInOven(28)}</g>,
  "oven-compact": <g>{builtInOven(43)}</g>,

  // ---- Microwaves -----------------------------------------------------------
  "micro-free": (
    <g>
      <path d="M4 88H92" />
      {microwave(12, 46, 68, 38)}
      <path {...fine} d="M18 84V88M74 84V88" />
    </g>
  ),
  "micro-builtin": <g>{microColumn(30, false)}</g>,
  // Niche height at 0.8 px per cm.
  "micro-n38": <g>{microColumn(30.4, true)}</g>,
  "micro-n45": <g>{microColumn(36, true)}</g>,
  // ---- Mini ovens ---------------------------------------------------------
  "minioven-plain": <g>{miniOven(12, 40, 72, 48)}</g>,
  "minioven-hob": (
    <g>
      <rect x={18} y={35} width={22} height={5} rx={2} />
      <rect x={46} y={35} width={22} height={5} rx={2} />
      {miniOven(12, 40, 72, 48)}
    </g>
  ),

  // ---- Coffee -------------------------------------------------------------
  "coffee-auto": (
    <g>
      <path d="M30 26V18Q30 15 33 15H49Q52 15 52 18V26" />
      <ellipse {...fine} cx={41} cy={20.5} rx={4.5} ry={3} transform="rotate(-25 41 20.5)" />
      <path {...fine} d="M38.5 22Q41 20.5 43.5 19" />
      <rect x={22} y={26} width={52} height={62} rx={4} />
      <rect {...fine} x={30} y={32} width={20} height={8} rx={1.5} />
      <circle {...fine} cx={64} cy={36} r={3} />
      <path d="M32 50H64V82H32Z" />
      <path d="M44 50V55H52V50" />
      <path d="M41 68H55V76Q55 80 51 80H45Q41 80 41 76Z" />
    </g>
  ),
  "coffee-capsule": (
    <g>
      <path d="M30 20Q30 14 36 14H60Q66 14 66 20V88H30Z" />
      <path d="M30 26H66" />
      <path {...fine} d="M44 34H52V38H44Z" />
      <path d="M33 82H63" />
      <path d="M41 64H55V72Q55 76 51 76H45Q41 76 41 72Z" />
      <path {...tint} d="M74 72H88L85.5 84H76.5Z" />
      <path d="M72.5 72H89.5" />
    </g>
  ),
  "coffee-manual": (
    <g>
      <rect x={14} y={30} width={62} height={58} rx={3} />
      <path {...fine} d="M14 40H76" />
      <circle {...fine} cx={64} cy={48} r={5} />
      <path {...fine} d="M64 48L66.5 45.5" />
      <rect x={34} y={44} width={16} height={6} rx={1} />
      <path d="M35 50H49L47 55H37Z" />
      <path d="M36 54L18 60" strokeWidth={3.5} />
      <path d="M37 70H47V76Q47 79 44 79H40Q37 79 37 76Z" />
      <path {...fine} d="M30 82H56" />
    </g>
  ),

  // ---- Grinders -----------------------------------------------------------
  "grinder-burr": (
    <g>
      <path d="M28 12H64L56 34H36Z" />
      <path {...tintOnly} d="M31 20H61L56 34H36Z" />
      <rect x={32} y={34} width={28} height={54} rx={2} />
      <circle {...fine} cx={46} cy={45} r={5} />
      <path {...fine} d="M46 45V40.5" />
      <rect x={37} y={60} width={18} height={22} rx={2} />
      <path {...fine} d="M40 68H52" />
    </g>
  ),
  "grinder-blade": (
    <g>
      <path d="M36 52V44Q36 34 48 34Q60 34 60 44V52" />
      <path {...fine} d="M42 46L54 46M48 43V49" />
      <rect x={34} y={52} width={28} height={36} rx={4} />
      <rect {...fine} x={43} y={62} width={10} height={5} rx={2.5} />
    </g>
  ),

  // ---- Blenders -----------------------------------------------------------
  "blender-jug": (
    <g>
      <path d="M30 70H66L70 88H26Z" />
      <circle {...fine} cx={48} cy={80} r={2.5} />
      <path d="M32 16H64L59 70H37Z" />
      <path d="M30 16H66" />
      <path {...tintOnly} d="M34.9 40H61.1L59 70H37Z" />
      <path {...fine} d="M35 40Q41.5 37 48 40T61 40" />
      <path d="M62.5 24H70V56H60" />
      <path {...fine} d="M42 62L54 66M54 62L42 66" />
    </g>
  ),
  "blender-personal": (
    <g>
      <path d="M36 70H60L63 88H33Z" />
      <circle {...fine} cx={48} cy={80} r={2.5} />
      <rect x={38} y={62} width={20} height={8} rx={1} />
      <path d="M40 62V20Q40 14 46 14H50Q56 14 56 20V62" />
      <path {...tintOnly} d="M40 32H56V62H40Z" />
      <path {...fine} d="M40 32Q44 30 48 32T56 32" />
    </g>
  ),

  // ---- Food processors / mixers -------------------------------------------
  "foodproc-stand": (
    <g>
      <rect x={14} y={82} width={66} height={6} rx={2} />
      <path d="M18 82V44Q18 38 24 38H32V82" />
      <path d="M18 40Q18 22 34 22H70Q80 22 80 31Q80 40 70 40H32" />
      <path {...fine} d="M56 40V50" />
      <path d="M40 54H72L68 80H44Z" />
      <path d="M38 54H74" />
      <path {...fine} d="M52 50Q56 62 60 50" />
    </g>
  ),
  "foodproc-processor": (
    <g>
      <rect x={26} y={66} width={44} height={22} rx={3} />
      <circle {...fine} cx={48} cy={77} r={3} />
      <path d="M28 66L30 30H66L68 66" />
      <path d="M67 38H74V58H67.5" />
      <rect x={52} y={14} width={10} height={16} rx={1} />
      <path d="M28 30H68" />
      <path {...fine} d="M48 62V44" />
      <path {...fine} d="M36 52Q42 46 48 52Q54 58 60 52" />
    </g>
  ),
  "mixer-hand": (
    <g>
      <path d="M34 26Q34 12 48 12H64Q74 12 74 22V26" />
      <path d="M24 46Q18 46 18 38Q18 26 30 26H72Q80 26 80 36V40Q80 46 74 46Z" />
      <path {...fine} d="M44 33H64" />
      <path d="M40 46V62M56 46V62" />
      <ellipse {...fine} cx={40} cy={72} rx={5} ry={10} />
      <ellipse {...fine} cx={56} cy={72} rx={5} ry={10} />
      <path {...fine} d="M40 62V82M56 62V82" />
    </g>
  ),
  "mixer-bowl": (
    <g>
      <rect x={10} y={82} width={76} height={6} rx={2} />
      <path d="M70 82V30" />
      <path d="M74 82V30" />
      <path d="M28 40Q22 40 22 34Q22 26 30 26H74V40Z" />
      <path {...fine} d="M38 40V58M50 40V58" />
      <ellipse {...fine} cx={38} cy={64} rx={3.5} ry={7} />
      <ellipse {...fine} cx={50} cy={64} rx={3.5} ry={7} />
      <path d="M20 56H66Q64 80 43 80Q22 80 20 56Z" />
    </g>
  ),

  // ---- Juicers ------------------------------------------------------------
  "juicer-centrif": (
    <g>
      <rect x={24} y={62} width={48} height={26} rx={4} />
      <circle {...fine} cx={48} cy={75} r={3} />
      <path d="M26 62Q26 44 48 44Q70 44 70 62" />
      <rect x={36} y={12} width={24} height={32} rx={2} />
      <rect {...tint} {...fine} x={38} y={8} width={20} height={8} rx={2} />
      <path d="M24 56H16V62" />
      <path d="M72 56H82V84H72" />
    </g>
  ),
  "juicer-slow": (
    <g>
      <rect x={32} y={64} width={32} height={24} rx={4} />
      <rect x={34} y={30} width={28} height={34} rx={3} />
      <path {...fine} d="M38 38L58 34M38 46L58 42M38 54L58 50M38 62L58 58" />
      <path d="M41 30V18H55V30" />
      <path d="M34 52H26V58M62 52H70V58" />
    </g>
  ),
  "juicer-citrus": (
    <g>
      <path d="M18 62H78L70 84H26Z" />
      <path d="M22 88H74" />
      <path d="M28 62Q32 32 48 28Q64 32 68 62" />
      <path {...fine} d="M48 28V62M48 28Q40 40 38 62M48 28Q56 40 58 62M48 28Q34 38 32 58M48 28Q62 38 64 58" />
      <path d="M78 66H86" />
    </g>
  ),

  // ---- Toasters, grills, sandwich makers ----------------------------------
  "toaster-2": <g>{toaster(26, 70, 2)}</g>,
  "toaster-4": <g>{toaster(12, 82, 4)}</g>,
  "grill-contact": (
    <g>
      <rect x={18} y={72} width={60} height={14} rx={3} />
      <path {...fine} d="M22 86V88M74 86V88" />
      <path
        d="M20 66L24 72L28 66L32 72L36 66L40 72L44 66L48 72L52 66L56 72L60 66L64 72L68 66L72 72L76 66"
        fill="none"
      />
      <path d="M18 66H78V56Q78 50 72 50H24Q18 50 18 56Z" />
      <path d="M18 58H8" strokeWidth={3} />
      <path d="M78 58L82 62V76L78 78" {...fine} />
    </g>
  ),
  "grill-plate": (
    <g>
      <path d="M18 48H78L88 68H8Z" />
      <path d="M48 48V68" />
      <path {...fine} d="M23.2 50L16.8 66M29.4 50L24.6 66M35.6 50L32.4 66M41.8 50L40.2 66" />
      <path d="M8 68V78Q8 82 12 82H84Q88 82 88 78V68" />
      <circle {...fine} cx={78} cy={75} r={3} />
      <path {...fine} d="M16 82V86M80 82V86" />
    </g>
  ),

  // ---- Fryers, dehydrators --------------------------------------------------
  "airfryer-air": (
    <g>
      <path d="M28 88V36Q28 22 48 22Q68 22 68 36V88Z" />
      <circle {...fine} cx={48} cy={36} r={5} />
      <path {...fine} d="M48 36V32" />
      <rect x={32} y={50} width={32} height={34} rx={4} />
      <rect {...tint} x={40} y={58} width={16} height={6} rx={3} />
    </g>
  ),
  "airfryer-oil": (
    <g>
      <path {...tintOnly} d="M22.8 64H73.2L70 88H26Z" />
      <path d="M18 50H78L72 88H24Z" />
      <path {...fine} d="M22 64Q34 61 48 64T74 64" />
      <path {...fine} d="M30 40H62V72H30Z" />
      <path {...fine} d="M30 48H62M30 56H62M38 40V72M46 40V72M54 40V72" />
      <path d="M62 44L82 30" strokeWidth={3} />
    </g>
  ),
  "dehydrator-small": <g>{dehydrator(4, 7)}</g>,
  "dehydrator-big": <g>{dehydrator(8, 6)}</g>,

  // ---- Irons, steamers, steam cleaners ------------------------------------
  "iron-iron": (
    <g>
      <path d="M10 74Q16 54 42 52H80V74Z" />
      <path d="M40 52Q42 34 56 34H78Q82 34 81 40L80 52" />
      <path {...fine} d="M50 52Q52 42 60 42H74" />
      <path {...fine} d="M10 74H80" />
      {dot(28, 80)}
      {dot(42, 81)}
      {dot(56, 80)}
      {dot(70, 81)}
    </g>
  ),
  "iron-station": (
    <g>
      <path d="M12 56Q18 40 36 38H60V56Z" />
      <path d="M34 38Q36 24 48 24H58Q62 24 61 30L60 38" />
      <path {...fine} d="M60 46Q78 44 78 58" />
      <rect x={8} y={58} width={80} height={30} rx={6} />
      <rect {...fine} x={56} y={66} width={24} height={14} rx={2} />
      <path {...fine} d="M56 72H80" />
      <circle {...fine} cx={20} cy={73} r={3} />
    </g>
  ),
  "steamer-hand": (
    <g>
      <path {...fine} d="M18 22q-3 -3 0 -6M14 30q-3 -3 0 -6M18 38q-3 -3 0 -6" />
      <rect x={24} y={14} width={12} height={30} rx={4} />
      <path d="M36 24H50V40H36" />
      <path d="M50 30H58V62" />
      <path d="M64 62V30" />
      <path d="M58 30Q61 26 64 30" />
      <rect x={52} y={62} width={20} height={24} rx={5} />
      <rect {...tintOnly} x={53} y={72} width={18} height={13} rx={4} />
    </g>
  ),
  "steamer-stand": (
    <g>
      <rect x={28} y={72} width={32} height={16} rx={4} />
      <rect {...tintOnly} x={30} y={78} width={28} height={9} rx={3} />
      <path d="M44 72V12" />
      <path {...fine} d="M44 12V9Q44 6 47 6Q50 6 50 9" />
      <path d="M30 22L44 14L58 22Z" />
      <path {...fine} d="M33 22L28 30V54H60V30L55 22" />
      <path {...fine} d="M60 78Q76 76 74 56" />
      <rect x={70} y={40} width={8} height={16} rx={3} />
    </g>
  ),
  "steamclean-cyl": (
    <g>
      <rect x={10} y={48} width={42} height={32} rx={10} />
      <path d="M22 48V42H40V48" />
      <circle cx={20} cy={82} r={5} />
      <circle cx={42} cy={82} r={5} />
      <path {...fine} d="M52 60C66 62 64 36 76 30" />
      <path d="M76 30L84 72" />
      <path d="M78 74H90" strokeWidth={3} />
      <path {...fine} d="M70 66q-3 -3 0 -6M66 74q-3 -3 0 -6" />
    </g>
  ),
  "steamclean-hand": (
    <g>
      <path d="M48 46V36Q48 28 56 28H68Q76 28 76 36V46" />
      <path {...fine} d="M56 36H68" />
      <rect x={42} y={46} width={40} height={40} rx={8} />
      <rect {...fine} x={50} y={60} width={24} height={18} rx={3} />
      <path {...fine} d="M50 68H74" />
      <path d="M42 56L22 60V68L42 72" />
      <rect x={10} y={58} width={12} height={12} rx={2} />
      <path {...fine} d="M10 74V78M14 74V78M18 74V78M22 74V78" />
    </g>
  ),
  "steamclean-mop": (
    <g>
      <path d="M52 8H60" strokeWidth={3.5} />
      <path d="M56 10L50 32" />
      <rect x={42} y={32} width={14} height={24} rx={4} transform="rotate(15 49 44)" />
      <rect {...tintOnly} x={44} y={44} width={10} height={10} rx={3} transform="rotate(15 49 44)" />
      <path d="M46 56L42 78" />
      <path d="M20 80H66Q70 80 70 84V88H16V84Q16 80 20 80Z" />
    </g>
  ),

  // ---- Vacuums ------------------------------------------------------------
  "vacuum-corded": (
    <g>
      <path d="M12 86V70Q12 58 26 58H34Q46 58 46 72V86Z" />
      <circle cx={36} cy={80} r={7} />
      <path {...fine} d="M46 68C64 70 62 40 72 32" />
      <path d="M72 32L80 82" />
      <path d="M68 85H90" strokeWidth={3.5} />
      <path {...fine} d="M12 74C6 74 6 60 10 54" />
      <rect {...fine} x={7} y={46} width={6} height={8} rx={1} />
      <path {...fine} d="M8.5 46V42M11.5 46V42" />
    </g>
  ),
  "vacuum-stick": (
    <g>
      <path d="M54 8H64Q68 8 66 14L62 26H52" />
      <rect {...tint} x={46} y={22} width={14} height={22} rx={5} transform="rotate(12 53 33)" />
      <path d="M50 44L42 82" />
      <path d="M26 84Q26 80 30 80H52Q56 80 56 84V88H26Z" />
    </g>
  ),
  "vacuum-robot": <g>{robotDisc()}</g>,
  "vacuum-robotmop": (
    <g>
      {robotDisc(
        <>
          <path {...tint} {...fine} d="M38 34Q42 40 42 42.5A4 4 0 0 1 34 42.5Q34 40 38 34Z" />
          <path {...tint} {...fine} d="M52 26Q56 32 56 34.5A4 4 0 0 1 48 34.5Q48 32 52 26Z" />
          <path {...tint} {...fine} d="M62 38Q66 44 66 46.5A4 4 0 0 1 58 46.5Q58 44 62 38Z" />
        </>,
      )}
    </g>
  ),

  // ---- Small kitchen appliances ---------------------------------------------
  kettle: (
    <g>
      <rect x={24} y={80} width={46} height={8} rx={2} />
      <path {...tintOnly} d="M31.8 56H62.2L64 80H30Z" />
      <path d="M34 28H60L64 80H30Z" />
      <path {...fine} d="M31.8 56Q39 53 47 56T62.2 56" />
      <path d="M34 28Q47 20 60 28" />
      <path {...fine} d="M45 22.5V20H49V22.5" />
      <path d="M33.6 33L20 26L33.1 42" />
      <path d="M60.4 34H70Q76 34 76 40V64Q76 70 70 70H62.6" />
    </g>
  ),
  handblender: (
    <g>
      <rect x={39} y={8} width={18} height={34} rx={8} />
      <rect {...tint} {...fine} x={44.5} y={15} width={7} height={9} rx={3} />
      <rect x={44.5} y={42} width={7} height={28} rx={1} />
      <path d="M44.5 70L35 82Q33 87 38 87H58Q63 87 61 82L51.5 70" />
      <path {...fine} d="M41 81H55" />
    </g>
  ),
  chopper: (
    <g>
      <rect {...fine} x={42} y={24} width={12} height={6} rx={2} />
      <path d="M32 52V44Q32 30 48 30Q64 30 64 44V52" />
      <path d="M26 52H70" />
      <path d="M28 52L31 80Q32 88 40 88H56Q64 88 65 80L68 52" />
      <path {...tintOnly} d="M30 70H66L65 80Q64 86 56 86H40Q32 86 31 80Z" />
      <path {...fine} d="M48 54V78M40 70L56 64" />
    </g>
  ),
  mincer: (
    <g>
      <path d="M10 28L16 36H56L62 28" />
      <path d="M30 36V46M40 36V46" />
      <rect x={52} y={46} width={34} height={40} rx={5} />
      <circle {...fine} cx={69} cy={66} r={3} />
      <path d="M20 46H52V70H20" />
      <circle cx={20} cy={58} r={12} />
      {dot(20, 52, 1.4)}
      {dot(15, 57, 1.4)}
      {dot(25, 57, 1.4)}
      {dot(17, 63, 1.4)}
      {dot(23, 63, 1.4)}
      {dot(20, 58, 1.4)}
      <path {...fine} d="M56 86V88M82 86V88" />
    </g>
  ),
  scale: (
    <g>
      <path d="M20 50H76L86 62H10Z" />
      <rect x={10} y={62} width={76} height={18} rx={3} />
      <rect {...tint} {...fine} x={34} y={66} width={20} height={10} rx={1.5} />
      <circle {...fine} cx={64} cy={71} r={2} />
      <circle {...fine} cx={72} cy={71} r={2} />
      <path {...fine} d="M16 80V84M80 80V84" />
    </g>
  ),
  knife: (
    <g>
      <path d="M54 42H14L6 48L12 54L15 51.5L18 54L21 51.5L24 54L27 51.5L30 54L33 51.5L36 54L39 51.5L42 54L45 51.5L48 54L51 51.5L54 54" />
      <path {...fine} d="M12 48H54" />
      <rect x={54} y={39} width={6} height={18} rx={1.5} />
      <path d="M60 40H80Q90 40 90 48Q90 58 80 58H60" />
      <path {...fine} d="M66 58Q70 65 76 58" />
      <rect {...tint} {...fine} x={68} y={44} width={12} height={5} rx={2.5} />
    </g>
  ),
  sandwich: (
    <g>
      <rect x={14} y={62} width={62} height={18} rx={6} />
      <path {...fine} d="M20 62V59H28V62M32 62V59H40V62M44 62V59H52V62M56 62V59H64V62" />
      <path {...fine} d="M20 84V80M70 84V80" />
      <g transform="rotate(-10 76 60)">
        <path d="M76 58V46Q76 40 70 40H20Q14 40 14 46V52Q14 58 20 58Z" />
        <path d="M14 49H4" strokeWidth={3} />
        <circle {...fine} cx={64} cy={49} r={2} />
      </g>
      <circle {...fine} cx={76} cy={60} r={2.5} />
    </g>
  ),
  breadmaker: (
    <g>
      <path d="M16 40Q16 24 32 24H64Q80 24 80 40" />
      <rect {...fine} x={26} y={28} width={44} height={12} rx={4} />
      <path {...tint} {...fine} d="M34 40V37Q34 31 41 31H55Q62 31 62 37V40Z" />
      <rect x={16} y={40} width={64} height={46} rx={4} />
      <rect {...fine} x={26} y={50} width={44} height={18} rx={2} />
      <rect {...tint} {...fine} x={30} y={54} width={16} height={10} rx={1} />
      <circle {...fine} cx={53} cy={59} r={2} />
      <circle {...fine} cx={62} cy={59} r={2} />
      <path {...fine} d="M22 86V88M74 86V88" />
    </g>
  ),
  vacuumsealer: (
    <g>
      <path d="M8 60Q8 50 18 50H78Q88 50 88 60V62H8Z" />
      <circle {...fine} cx={72} cy={56} r={1.8} />
      <circle {...fine} cx={79} cy={56} r={1.8} />
      <path d="M8 62H88V72Q88 76 84 76H64M32 76H12Q8 76 8 72V62" />
      <path {...tint} {...fine} d="M33 62H63L64 82Q64 88 58 88H38Q32 88 32 82Z" />
      <path {...dashed} d="M33 67H63" />
    </g>
  ),
};
