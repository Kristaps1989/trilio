import { decodeEntities } from "../scrape/jsonld";

// Reads a product page's specification table into label → value pairs.
// Every shop renders specs as label/value pairs; only the markup differs:
//   euronics.lv  <span class="specification__title">…</span><span class="specification__value">…</span>
//   tet.lv       <span class="i-specs-table__label-text">…</span> … <span class="i-specs-table__value-el">…</span>
//   m79.lv       <div class="spec_line">Label: <span class="value">…</span></div>
//   generic      <th>…</th><td>…</td> and <dt>…</dt><dd>…</dd>
// Labels are normalised (lower case, no trailing colon, single spaces) so
// the attribute catalogue (data/attributes.json) can match them. The first
// value for a label wins; shops repeat key specs in summaries.

export type SpecTable = Record<string, string>;

const PATTERNS: RegExp[] = [
  /<span[^>]*class="[^"]*specification__title[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class="[^"]*specification__value[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
  /class="[^"]*i-specs-table__label-text[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]{0,1500}?class="[^"]*i-specs-table__value(?:-el)?[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/gi,
  /<div[^>]*class="[^"]*spec_line[^"]*"[^>]*>([^<]*?)<span[^>]*class="[^"]*value[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
  /<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi,
  /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
];

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseLabel(label: string): string {
  return text(label)
    .toLowerCase()
    .replace(/\s*:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_LABEL = 80;
const MAX_VALUE = 300;

export function extractSpecTable(html: string): SpecTable {
  const table: SpecTable = {};
  for (const re of PATTERNS) {
    for (const m of html.matchAll(re)) {
      const label = normaliseLabel(m[1] ?? "");
      const value = text(m[2] ?? "");
      if (!label || !value || label.length > MAX_LABEL || value.length > MAX_VALUE) continue;
      if (!(label in table)) table[label] = value;
    }
  }
  // Fallback: "Label: value, Label: value" in the meta description (tet.lv, m79.lv put key specs there).
  const meta = html.match(/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]{0,2000})"/i)?.[1];
  if (meta) {
    for (const part of decodeEntities(meta).split(/\s*[;,]\s*(?=[A-ZĀČĒĢĪĶĻŅŠŪŽ][^:;,]{1,60}:)/)) {
      const m = part.match(/^([A-ZĀČĒĢĪĶĻŅŠŪŽ][^:;]{1,60}):\s*(.{1,120})$/);
      if (!m) continue;
      const label = normaliseLabel(m[1]!);
      if (!(label in table)) table[label] = m[2]!.trim().replace(/[;,]\s*$/, "");
    }
  }
  return table;
}
