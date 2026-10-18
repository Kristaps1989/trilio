import type { ReactElement } from "react";

// Picture-card line drawings. One shared style: single-colour line art on a
// 96 × 96 box, the <svg> wrapper (Illustration.tsx) sets stroke, width 2 and
// round caps. Objects stand on an implied ground line at y = 88.
//
// To-scale families (fridge-*, freezer-*, dish-*, washer-*, dryer-*, place-*
// except place-home / place-garage) use 0.4 px per cm and carry the same 180 cm
// person at the right edge as a size reference.

export type Drawing = ReactElement; // the inner SVG content

const fine = { strokeWidth: 1.5 } as const;
const tint = { fill: "currentColor", fillOpacity: 0.15 } as const;
const tintOnly = { fill: "currentColor", fillOpacity: 0.15, stroke: "none" } as const;
const dashed = { strokeDasharray: "3 3", strokeWidth: 1.5 } as const;

// ---------------------------------------------------------------------------
// Shared fragments

/** 180 cm person (72 px), standing on y = 88 at x ≈ 82–92. */
function person() {
  return (
    <g {...fine}>
      <circle cx={87} cy={20.5} r={4.5} />
      <rect x={82.5} y={28} width={9} height={26} rx={3.5} />
      <path d="M85.2 54V88M88.8 54V88" />
    </g>
  );
}

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

/** Worktop slab whose top is at counter height 90 cm (y = 52). */
function worktop(x1: number, x2: number) {
  return <rect x={x1} y={50} width={x2 - x1} height={4} rx={1} />;
}

/** Plain base cabinet under the worktop (y 54–88) with a small handle. */
function baseCabinet(x: number, w: number, handleRight = true) {
  const hx = handleRight ? x + w - 4 : x + 4;
  return (
    <>
      <rect x={x} y={54} width={w} height={34} rx={1} />
      <path {...fine} d={`M${hx} 58V64`} />
    </>
  );
}

/** Freestanding washer front, 60 × 85 cm, top-left at (x, 54). */
function washerBody(x: number, y = 54) {
  return (
    <>
      <rect x={x} y={y} width={24} height={34} rx={2} />
      <path {...fine} d={`M${x} ${y + 6}H${x + 24}`} />
      <circle {...fine} cx={x + 19} cy={y + 3} r={1.4} />
      <rect {...fine} x={x + 3.5} y={y + 2} width={6} height={2} rx={0.5} />
      <circle cx={x + 12} cy={y + 20} r={8.5} />
    </>
  );
}

function washerDrum(x: number, y = 54) {
  return <circle {...fine} cx={x + 12} cy={y + 20} r={5.5} />;
}

/** Warm-air waves inside a dryer door. */
function airWaves(cx: number, cy: number) {
  return (
    <path {...fine} d={`M${cx - 5} ${cy - 2}q2.5 -2.5 5 0t5 0M${cx - 5} ${cy + 2.5}q2.5 -2.5 5 0t5 0`} />
  );
}

/** Freestanding dishwasher front, 60 × 85 cm, top-left at (x, 54). */
function dishwasherBody(x: number) {
  return (
    <>
      <rect x={x} y={54} width={24} height={34} rx={2} />
      <path {...fine} d={`M${x} 60H${x + 24}`} />
      <rect {...fine} x={x + 3.5} y={56} width={6} height={2} rx={0.5} />
      {dot(x + 14, 57)}
      {dot(x + 17.5, 57)}
      {dot(x + 21, 57)}
      <path d={`M${x + 7} 64H${x + 17}`} />
      <path {...fine} d={`M${x + 2} 84H${x + 22}`} />
    </>
  );
}

/** Kitchen tall column (60 × 190 cm) next to a base cabinet, with a hidden appliance. */
function tallColumn(extra?: ReactElement) {
  return (
    <>
      {worktop(10, 36)}
      {baseCabinet(12, 24, false)}
      <rect x={36} y={12} width={24} height={76} rx={1} />
      <path d="M36 58H60" />
      <path {...fine} d="M57.5 50V55M57.5 61V66" />
      <rect {...dashed} x={39} y={15.5} width={15} height={69} rx={1.5} />
      {extra}
    </>
  );
}

// ---------------------------------------------------------------------------
// Microwave / oven parts

function microwave(x: number, y: number, w: number, h: number, inside?: ReactElement) {
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
      {inside}
    </>
  );
}

function fan(cx: number, cy: number) {
  const blade = `M${cx} ${cy}c-1.5 -4 0.5 -7.5 4.5 -7.5c0.5 4 -1.5 6.5 -4.5 7.5Z`;
  return (
    <g {...fine}>
      <path d={blade} />
      <path d={blade} transform={`rotate(120 ${cx} ${cy})`} />
      <path d={blade} transform={`rotate(240 ${cx} ${cy})`} />
    </g>
  );
}

function builtInMicro(nicheTop: number, nicheH: number) {
  const bottom = nicheTop + nicheH;
  return (
    <g>
      <rect x={22} y={6} width={48} height={82} rx={1} />
      <path d={`M22 ${nicheTop}H70M22 ${bottom}H70`} />
      <path {...fine} d={`M64 ${nicheTop - 9}V${nicheTop - 4}M64 ${bottom + 4}V${bottom + 9}`} />
      {microwave(25, nicheTop + 2.5, 42, nicheH - 5)}
      <path {...fine} d={`M80 ${nicheTop}V${bottom}M77 ${nicheTop}H83M77 ${bottom}H83`} />
    </g>
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

function plate(cx: number, cy: number) {
  return (
    <>
      <circle cx={cx} cy={cy} r={11} />
      <circle {...fine} cx={cx} cy={cy} r={6.5} />
    </>
  );
}

function cube(cx: number, cy: number, s: number) {
  const dx = s * 0.866;
  const dy = s / 2;
  return (
    <>
      <path
        {...tint}
        d={`M${cx} ${cy - s}L${cx + dx} ${cy - dy}L${cx} ${cy}L${cx - dx} ${cy - dy}Z`}
        strokeWidth={0}
      />
      <path
        d={`M${cx} ${cy - s}L${cx + dx} ${cy - dy}V${cy + dy}L${cx} ${cy + s}L${cx - dx} ${cy + dy}V${cy - dy}Z`}
      />
      <path {...fine} d={`M${cx - dx} ${cy - dy}L${cx} ${cy}L${cx + dx} ${cy - dy}M${cx} ${cy}V${cy + s}`} />
    </>
  );
}

function kettleBody() {
  return (
    <>
      <path d="M35 30H61L67 80H29Z" />
      <path d="M37 30Q48 21 59 30" />
      <path d="M46 23.5H50" />
      <path d="M61.5 35H69Q75 35 75 41V64Q75 70 69 70H65.5" />
      <path d="M34 42L23 33Q21 31.5 21 34.5L32.5 54" />
      <rect x={25} y={80} width={46} height={8} rx={2} />
    </>
  );
}

function stickBlender(cordless: boolean) {
  return (
    <>
      <rect x={40} y={10} width={16} height={36} rx={7} />
      <path d="M44 46V74M52 46V74" />
      <path d="M37 74H59L56 84H40Z" />
      {cordless ? (
        <>
          <rect {...fine} x={45} y={22} width={6} height={12} rx={1} />
          <path {...fine} d="M47 20.5H49" />
          <rect {...tintOnly} x={45} y={28} width={6} height={6} />
        </>
      ) : (
        <>
          {dot(48, 22, 2)}
          <path {...fine} d="M56 16C70 14 78 20 78 34S70 64 86 86" />
        </>
      )}
    </>
  );
}

function carvingKnife(cordless: boolean) {
  return (
    <>
      <rect x={48} y={38} width={38} height={18} rx={8} />
      <path d="M48 42H16L10 47L16 52H48" />
      <path {...fine} d="M14 47H48" />
      <path {...fine} d="M60 44H72" />
      {cordless ? (
        <>
          <rect {...fine} x={60} y={47} width={12} height={5} rx={1} />
          <path {...fine} d="M73.5 48.5V50.5" />
          <rect {...tintOnly} x={60} y={47} width={6} height={5} />
        </>
      ) : (
        <path {...fine} d="M82 56C84 70 72 72 70 86" />
      )}
    </>
  );
}

function sofa() {
  return (
    <>
      <path d="M20 66V54Q20 50 24 50H34" />
      <path d="M62 50H72Q76 50 76 54V66" />
      <rect x={10} y={62} width={12} height={20} rx={4} />
      <rect x={74} y={62} width={12} height={20} rx={4} />
      <path d="M22 68H74M22 82H74" />
      <path d="M16 82V87M80 82V87" />
    </>
  );
}

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

function floorPlan(d: string, inner: string) {
  return (
    <>
      <path d={d} strokeWidth={2.5} />
      <path {...fine} d={inner} />
    </>
  );
}

// ---------------------------------------------------------------------------

export const DRAWINGS: Record<string, Drawing> = {
  // ---- Fridges (to scale) -------------------------------------------------
  "fridge-combi": (
    <g>
      <rect {...tintOnly} x={28} y={62} width={24} height={26} />
      <rect x={28} y={14} width={24} height={74} rx={2} />
      <path d="M28 62H52" />
      <path d="M48.5 48V57M48.5 66V72" />
      {person()}
    </g>
  ),
  "fridge-single": (
    <g>
      <rect x={28} y={14} width={24} height={74} rx={2} />
      <path d="M48.5 30V52" />
      {person()}
    </g>
  ),
  "fridge-compact": (
    <g>
      <rect x={29} y={54} width={22} height={34} rx={2} />
      <path d="M47.5 58V68" />
      {person()}
    </g>
  ),
  "fridge-sbs": (
    <g>
      <rect {...tintOnly} x={22} y={17} width={18} height={71} />
      <rect x={22} y={17} width={36} height={71} rx={2} />
      <path d="M40 17V88" />
      <path d="M36.5 36V54M43.5 36V54" />
      {person()}
    </g>
  ),
  "fridge-builtin": (
    <g>
      {tallColumn(<path {...dashed} d="M39 64H54" />)}
      {person()}
    </g>
  ),

  // ---- Freezers (to scale) ------------------------------------------------
  "freezer-upright": (
    <g>
      <rect x={28} y={26} width={24} height={62} rx={2} />
      {snowflake(38, 36, 5)}
      <path {...fine} d="M31 50H45M31 63H45M31 76H45" />
      <path d="M48.5 32V44" />
      {person()}
    </g>
  ),
  "freezer-chest": (
    <g>
      <rect x={20} y={54} width={40} height={34} rx={2} />
      <path d="M20 61H60" />
      <path d="M35 65H45" />
      {snowflake(40, 77, 5)}
      {person()}
    </g>
  ),
  "freezer-builtin": (
    <g>
      {tallColumn(snowflake(46.5, 32, 5))}
      {person()}
    </g>
  ),

  // ---- Dishwashers (to scale) ---------------------------------------------
  "dish-free": (
    <g>
      {dishwasherBody(28)}
      {person()}
    </g>
  ),
  "dish-builtin60": (
    <g>
      {worktop(8, 76)}
      {baseCabinet(8, 22, true)}
      {baseCabinet(54, 22, false)}
      <rect x={30} y={54} width={24} height={34} rx={1} />
      <path d="M37 58H47" />
      <rect {...dashed} x={32.5} y={61} width={19} height={24.5} rx={1} />
      {person()}
    </g>
  ),
  "dish-builtin45": (
    <g>
      {worktop(11, 73)}
      {baseCabinet(11, 22, true)}
      {baseCabinet(51, 22, false)}
      <rect x={33} y={54} width={18} height={34} rx={1} />
      <path d="M38 58H46" />
      <rect {...dashed} x={35.5} y={61} width={13} height={24.5} rx={1} />
      {person()}
    </g>
  ),
  "dish-full": (
    <g>
      {worktop(8, 76)}
      {baseCabinet(8, 22, true)}
      {baseCabinet(54, 22, false)}
      <rect x={30} y={54} width={24} height={34} rx={1} />
      <path d="M37 58H47" />
      <rect {...dashed} x={32.5} y={61} width={19} height={24.5} rx={1} />
      {person()}
    </g>
  ),
  "dish-semi": (
    <g>
      {worktop(8, 76)}
      {baseCabinet(8, 22, true)}
      {baseCabinet(54, 22, false)}
      <rect {...tint} x={30} y={54} width={24} height={7} rx={1} />
      <rect {...fine} x={33} y={56} width={6} height={2.5} rx={0.5} />
      {dot(44, 57.3)}
      {dot(47.5, 57.3)}
      {dot(51, 57.3)}
      <rect x={30} y={61} width={24} height={27} rx={1} />
      <path d="M37 65H47" />
      <rect {...dashed} x={32.5} y={68} width={19} height={17.5} rx={1} />
      {person()}
    </g>
  ),
  "dish-tabletop": (
    <g>
      {worktop(10, 70)}
      <rect x={14} y={54} width={52} height={34} rx={1} />
      <path d="M40 54V88" />
      <path {...fine} d="M36 58V64M44 58V64" />
      <rect x={29} y={32} width={22} height={18} rx={2} />
      <path {...fine} d="M29 36H51" />
      {dot(44, 34)}
      {dot(47.5, 34)}
      <path d="M35 40H45" />
      {person()}
    </g>
  ),

  // ---- Washers (to scale) -------------------------------------------------
  "washer-front": (
    <g>
      {washerBody(28)}
      {washerDrum(28)}
      {person()}
    </g>
  ),
  "washer-top": (
    <g>
      <path d="M32 52L35 45H45L48 52" />
      <ellipse {...fine} cx={40} cy={48.5} rx={4} ry={1.6} />
      <rect x={32} y={52} width={16} height={36} rx={2} />
      <path {...fine} d="M32 58H48" />
      <circle {...fine} cx={44} cy={55} r={1.3} />
      <path {...fine} d="M34 84H46" />
      {person()}
    </g>
  ),
  "washer-combo": (
    <g>
      {washerBody(28)}
      {airWaves(40, 74)}
      {person()}
    </g>
  ),

  // ---- Dryers (to scale) --------------------------------------------------
  "dryer-heatpump": (
    <g>
      {washerBody(28)}
      <path {...tint} {...fine} d="M35.5 79Q35 69 45.5 67.5Q46 78 35.5 79Z" />
      <path {...fine} d="M35.5 79L42 72" />
      {person()}
    </g>
  ),
  "dryer-condenser": (
    <g>
      {washerBody(28)}
      <path {...tint} {...fine} d="M40 66.5Q45 72.5 45 75.5A5 5 0 0 1 35 75.5Q35 72.5 40 66.5Z" />
      {person()}
    </g>
  ),
  "dryer-side": (
    <g>
      {washerBody(15)}
      {washerDrum(15)}
      {washerBody(41)}
      {airWaves(53, 74)}
      {person()}
    </g>
  ),
  "dryer-stack": (
    <g>
      {washerBody(28, 19)}
      {airWaves(40, 39)}
      {washerBody(28)}
      {washerDrum(28)}
      {person()}
    </g>
  ),

  // ---- Washer placement (to scale) ----------------------------------------
  "place-free": (
    <g>
      {washerBody(28)}
      {washerDrum(28)}
      {person()}
    </g>
  ),
  "place-under": (
    <g>
      {worktop(8, 62)}
      {baseCabinet(8, 20, true)}
      {washerBody(30)}
      {washerDrum(30)}
      {person()}
    </g>
  ),
  "place-builtin": (
    <g>
      {worktop(8, 76)}
      {baseCabinet(8, 22, true)}
      {baseCabinet(54, 22, false)}
      <rect x={30} y={54} width={24} height={34} rx={1} />
      <path d="M37 58H47" />
      <rect {...dashed} x={32.5} y={61} width={19} height={24.5} rx={1} />
      <circle {...dashed} cx={42} cy={73.5} r={7.5} />
      {person()}
    </g>
  ),
  "place-home": (
    <g>
      <path d="M12 48L48 18L84 48" />
      <path d="M20 42V88H76V42" />
      <rect x={30} y={66} width={26} height={16} rx={2} />
      <path {...fine} d="M36 66V82M43 66V82M50 66V82M32 82V86M54 82V86" />
      <path {...fine} d="M36 60q-2 -3 0 -6t0 -6M43 60q-2 -3 0 -6t0 -6M50 60q-2 -3 0 -6t0 -6" />
      <path {...fine} d="M62 66H70V88" />
    </g>
  ),
  "place-garage": (
    <g>
      <path d="M10 44L48 24L86 44" />
      <path d="M16 41V88M80 41V88" />
      <rect x={24} y={52} width={48} height={36} rx={1} />
      <path {...fine} d="M24 61H72M24 70H72M24 79H72" />
      {snowflake(48, 37, 5.5)}
    </g>
  ),

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

  // ---- Microwaves ---------------------------------------------------------
  "micro-free": (
    <g>
      <path d="M4 88H92" />
      {microwave(12, 46, 68, 38)}
      <path {...fine} d="M18 84V88M74 84V88" />
    </g>
  ),
  "micro-solo": <g>{microwave(10, 44, 76, 44)}</g>,
  "micro-grill": (
    <g>
      {microwave(
        10,
        44,
        76,
        44,
        <path {...fine} d="M19 56L23 53L27 56L31 53L35 56L39 53L43 56L47 53L51 56L55 53" />,
      )}
    </g>
  ),
  "micro-combi": <g>{microwave(10, 44, 76, 44, fan(37, 66))}</g>,
  "micro-builtin38": <g>{builtInMicro(32, 20)}</g>,
  "micro-builtin45": <g>{builtInMicro(28, 30)}</g>,

  // ---- Mini ovens ---------------------------------------------------------
  "minioven-plain": <g>{miniOven(12, 40, 72, 48)}</g>,
  "minioven-hob": (
    <g>
      <rect x={18} y={35} width={22} height={5} rx={2} />
      <rect x={46} y={35} width={22} height={5} rx={2} />
      {miniOven(12, 40, 72, 48)}
    </g>
  ),
  "minioven-small": (
    <g>
      {miniOven(
        18,
        44,
        60,
        44,
        <>
          <path {...fine} d="M23 77H59" />
          <ellipse {...tint} {...fine} cx={41} cy={71} rx={13} ry={4.5} />
          {dot(36, 70)}
          {dot(44, 72)}
          {dot(46, 69.5)}
        </>,
      )}
    </g>
  ),
  "minioven-big": (
    <g>
      {miniOven(
        8,
        24,
        80,
        64,
        <>
          <path {...fine} d="M13 78H67" />
          <path {...tint} {...fine} d="M24 77Q22 61 40 60Q58 61 56 77Z" />
          <ellipse {...tint} {...fine} cx={27} cy={66} rx={7} ry={4.5} transform="rotate(-40 27 66)" />
          <ellipse {...tint} {...fine} cx={53} cy={66} rx={7} ry={4.5} transform="rotate(40 53 66)" />
          <path {...fine} d="M23 61L19 56.5M57 61L61 56.5" />
          <circle {...fine} cx={17.5} cy={55.5} r={1.8} />
          <circle {...fine} cx={62.5} cy={55.5} r={1.8} />
        </>,
      )}
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
  "coffee-black": (
    <g>
      <path {...fine} d="M44 44q-3 -4 0 -8t0 -8M52 44q-3 -4 0 -8t0 -8" />
      <path d="M34 52H62V62Q62 74 48 74Q34 74 34 62Z" />
      <path {...tintOnly} d="M35 55H61V62Q61 72 48 72Q35 72 35 62Z" />
      <path d="M62 56Q70 56 70 61Q70 66 61 66" />
      <path d="M24 78H72" />
    </g>
  ),
  "coffee-milk": (
    <g>
      <path d="M32 18L36 86H60L64 18" />
      <path {...fine} d="M33 30H63" />
      <path {...tintOnly} d="M34.2 56H61.8L60 86H36Z" />
      <path {...fine} d="M34 56Q41 52 48 56T62 56" />
      {dot(42, 24)}
      {dot(50, 22.5)}
      {dot(56, 25.5)}
      <path {...fine} d="M44 12L52 76" />
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
  "handblender-cord": <g>{stickBlender(false)}</g>,
  "handblender-cordless": <g>{stickBlender(true)}</g>,
  "knife-cord": <g>{carvingKnife(false)}</g>,
  "knife-cordless": <g>{carvingKnife(true)}</g>,

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

  // ---- Kettles ------------------------------------------------------------
  "kettle-steel": (
    <g>
      {kettleBody()}
      <path {...fine} d="M41 36L38 72" />
    </g>
  ),
  "kettle-glass": (
    <g>
      {kettleBody()}
      <path {...tintOnly} d="M31.7 54H64.3L67 80H29Z" />
      <path {...fine} d="M32 54Q40 51 48 54T64 54" />
      <circle {...fine} cx={44} cy={68} r={1.5} />
      <circle {...fine} cx={52} cy={62} r={1.2} />
      <circle {...fine} cx={48} cy={74} r={1.2} />
    </g>
  ),
  "kettle-temp": (
    <g>
      {kettleBody()}
      <circle cx={48} cy={56} r={8} />
      <path {...fine} d="M48 56L52.5 51.5M42 60.5H54" />
      {dot(48, 56, 1.3)}
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
      <rect x={8} y={52} width={80} height={6} rx={3} />
      <rect {...tint} {...fine} x={20} y={46} width={14} height={6} rx={3} />
      <rect {...tint} {...fine} x={40} y={46} width={18} height={6} rx={3} />
      <circle {...tint} {...fine} cx={68} cy={48.5} r={3.5} />
      <rect x={16} y={58} width={64} height={24} rx={3} />
      <path {...fine} d="M24 68H40V72H24ZM56 68H72V72H56Z" />
      <path {...fine} d="M22 82V88M74 82V88" />
    </g>
  ),
  "sandwich-sand": (
    <g>
      <rect x={8} y={26} width={39} height={46} rx={4} />
      <rect x={49} y={26} width={39} height={46} rx={4} />
      <path {...fine} d="M13 31H42V67H13ZM13 31L42 67M54 31H83V67H54ZM54 31L83 67" />
      <path d="M22 72V82H33V72M63 72V82H74V72" />
    </g>
  ),
  "sandwich-multi": (
    <g>
      <rect x={8} y={26} width={39} height={46} rx={4} />
      <rect x={49} y={26} width={39} height={46} rx={4} />
      <path {...fine} d="M13 31H42V67H13ZM20 31V67M27.5 31V67M35 31V67M13 40H42M13 49H42M13 58H42" />
      <path {...fine} d="M54 36H83M54 44H83M54 52H83M54 60H83" />
      <path d="M22 72V82H33V72M63 72V82H74V72" />
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
      <rect x={8} y={70} width={80} height={18} rx={5} />
      <rect {...tint} {...fine} x={56} y={75} width={24} height={8} rx={2} />
      <path d="M14 70Q18 56 36 55H58V70" />
      <path d="M32 55Q34 42 44 42H58Q61 42 60 47L58 55" />
      <path {...fine} d="M58 48Q76 44 82 58Q84 64 80 70" />
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
      <path d="M36 42Q36 28 50 28H62Q70 28 70 36V42" />
      <rect x={30} y={42} width={44} height={36} rx={8} />
      <rect {...tintOnly} x={33} y={60} width={38} height={15} rx={5} />
      <path d="M30 56H20L14 58V62L20 64H30" />
      <path {...fine} d="M10 50q-3 -3 0 -6M8 62q-3 -3 0 -6M10 74q-3 -3 0 -6" />
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
      <path {...fine} d="M12 74q-3 -3 0 -6M78 74q3 -3 0 -6" />
    </g>
  ),

  // ---- Scales -------------------------------------------------------------
  "scale-kitchen": (
    <g>
      <path d="M26 62Q26 44 48 44Q70 44 70 62" />
      <rect x={12} y={62} width={72} height={6} rx={3} />
      <rect x={16} y={68} width={64} height={16} rx={2} />
      <rect {...fine} x={38} y={72} width={20} height={8} rx={1.5} />
      <path {...fine} d="M20 84V88M76 84V88" />
    </g>
  ),
  "scale-precise": (
    <g>
      <path {...fine} d="M40 70Q40 64 48 64Q56 64 56 70" />
      <rect x={34} y={70} width={28} height={4} rx={2} />
      <rect x={32} y={74} width={32} height={14} rx={2} />
      <rect {...fine} x={42} y={77} width={12} height={6} rx={1} />
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

  // ---- Pets, portions, area, uses -----------------------------------------
  "pets-yes": (
    <g>
      {sofa()}
      <path d="M36 68Q34 56 40 52M60 68Q62 56 56 52" />
      <path d="M36 50L34 32L42 38H54L62 32L60 50Q60 58 48 58Q36 58 36 50Z" />
      {dot(43, 46, 1.4)}
      {dot(53, 46, 1.4)}
      <path {...fine} d="M46.5 50.5H49.5L48 52Z" />
      <path {...fine} d="M38 52L28 51M38 54L29 56M58 52L68 51M58 54L67 56" />
    </g>
  ),
  "pets-no": (
    <g>
      {sofa()}
      <path d="M34 50H62" />
      <rect {...fine} x={28} y={54} width={18} height={14} rx={4} />
    </g>
  ),
  "portions-2": (
    <g>
      {plate(32, 48)}
      {plate(64, 48)}
    </g>
  ),
  "portions-4": (
    <g>
      {plate(32, 34)}
      {plate(64, 34)}
      {plate(32, 62)}
      {plate(64, 62)}
    </g>
  ),
  "portions-6": (
    <g>
      {plate(20, 34)}
      {plate(48, 34)}
      {plate(76, 34)}
      {plate(20, 62)}
      {plate(48, 62)}
      {plate(76, 62)}
    </g>
  ),
  "area-small": <g>{floorPlan("M30 30H66V66H30Z", "M30 56A10 10 0 0 1 40 66")}</g>,
  "area-mid": (
    <g>{floorPlan("M16 24H80V72H16Z", "M48 24V42M48 52V72M48 52H58M68 52H80M16 62A10 10 0 0 1 26 72")}</g>
  ),
  "area-big": (
    <g>
      {floorPlan(
        "M8 10H88V86H8Z",
        "M36 10V30M36 40V60M8 48H24M30 48H36M36 60V86M60 10V26M60 36V50H76M82 50H88M60 50V70M60 78V86M36 70H48M54 70H60",
      )}
    </g>
  ),
  "use-ice": (
    <g>
      {cube(48, 36, 13)}
      {cube(31, 66, 13)}
      {cube(65, 66, 13)}
    </g>
  ),
  "use-smoothie": (
    <g>
      <path d="M30 28H66L61 86H35Z" />
      <path {...tintOnly} d="M31.6 40H64.4L61 86H35Z" />
      <path {...fine} d="M31.5 40Q40 37 48 40T64.5 40" />
      <path d="M50 76L58 12H68" />
    </g>
  ),
  "use-soup": (
    <g>
      <path {...fine} d="M38 44q-4 -5 0 -10t0 -10M48 42q-4 -5 0 -10t0 -10M58 44q-4 -5 0 -10t0 -10" />
      <path d="M16 54H80Q78 80 48 80Q18 80 16 54Z" />
      <path {...tintOnly} d="M18 56H78Q76 66 70 70H26Q20 66 18 56Z" />
      <path d="M38 80V86H58V80" />
    </g>
  ),
};
