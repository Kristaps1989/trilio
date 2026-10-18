import { describe, expect, it } from "vitest";
import { extractSpecTable, normaliseLabel } from "./table";

// Markup copied from the three partner shops' product pages (October 2026).

const EURONICS = `
<div class="specification__row">
    <span class="specification__title">
        instal&#x101;cijas veids
    </span>
    <span class="specification__value">
br&#x12B;vi st&#x101;vo&#x161;ie
    </span>
</div>
<div class="specification__row"><span class="specification__title">augstums</span><span class="specification__value">203 cm</span></div>`;

const TET = `
<div class="i-specs-table__row"><div class="i-specs-table__label"><span class="i-specs-table__label-text">
    Trokšņa līmenis:
</span><span class="i-specification-tooltip"><span class="i-specification-tooltip__icon js-spec-popover-btn" data-content="Trokšņa līmenis decibelos."></span></span></div><div class="i-specs-table__value"><span class="i-specs-table__value-el">35 dB    </span></div></div>`;

const M79 = `
<div class="spec_line">
Augstums:
<span class="value">
840                     mm      </span>
</div>`;

const META = `<meta name="description" content="Samsung RB34C7B5EB1/EF Saldētava apakšā, Augstums: 185.3 cm, Platums: 59.5 cm, Energoefektivitātes klase (A - G): E">`;

describe("extractSpecTable", () => {
  it("reads euronics.lv specification rows and decodes entities", () => {
    expect(extractSpecTable(EURONICS)).toEqual({ "instalācijas veids": "brīvi stāvošie", augstums: "203 cm" });
  });
  it("reads tet.lv rows across the tooltip markup", () => {
    expect(extractSpecTable(TET)).toEqual({ "trokšņa līmenis": "35 dB" });
  });
  it("reads m79.lv spec lines", () => {
    expect(extractSpecTable(M79)).toEqual({ augstums: "840 mm" });
  });
  it("falls back to 'Label: value' pairs in the meta description", () => {
    expect(extractSpecTable(META)).toMatchObject({
      augstums: "185.3 cm",
      platums: "59.5 cm",
      "energoefektivitātes klase (a - g)": "E",
    });
  });
  it("keeps the first value of a repeated label", () => {
    expect(extractSpecTable(`<dl><dt>Platums</dt><dd>60 cm</dd><dt>Platums</dt><dd>59 cm</dd></dl>`)).toEqual({
      platums: "60 cm",
    });
  });
  it("normalises labels", () => {
    expect(normaliseLabel("  Kopējais tilpums (bruto): ")).toBe("kopējais tilpums (bruto)");
  });
});
