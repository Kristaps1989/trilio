import { describe, expect, it } from "vitest";
import { brandPoints } from "@/domain/ranking/quality";
import { brandTable, gradeOf } from "@/domain/ranking/consider";
import { normaliseProduct, sanityCheck } from "./normalise";

// Personal care (19 Oct 2026). Names and shop categories as the three
// scraped shops publish them, measured on the live sites.

const type = (sub: string, name: string, category: string, key: string) =>
  normaliseProduct(sub, { name, category }).attributes[key];

describe("personal care type rules", () => {
  it.each([
    ["Philips OneBlade Pro 360 Seja + ķermenis, tumši pelēka - Skuveklis/trimmeris", "skuvekli", "hybrid"],
    ["Philips Series 5000 Wet & Dry S5885/35", "skuvekli", "rotary"],
    ["Braun Series X XT5100", "skuvekli", "hybrid"],
    ["Braun Series 7 70-N1200s", "skuvekli", "foil"],
    ["Remington skuveklis sievietēm WDF5030", "sieviesu skuvekli", "lady"],
  ])("shaver %s → %s", (name, category, expected) => {
    // Braun Series X (XT…) is Braun's OneBlade-type hybrid.
    expect(type("shaver", name, category, "shaver_type")).toBe(expected);
  });

  it.each([
    ["Philips Multigroom 7000 MG7920/15, 15 vienā", "matu-un-bardas-trimmeri", "multi"],
    ["Philips Body Groom 7000 BG7470/15", "matu-un-bardas-trimmeri", "body"],
    ["Wahl Super Taper", "matu-griezamas-masinas", "clipper"],
    ["Braun BT3420 bārdas trimmeris", "matu-un-bardas-trimmeri", "beard"],
  ])("trimmer %s → %s", (name, category, expected) => {
    expect(type("trimmer", name, category, "trimmer_type")).toBe(expected);
  });

  it.each([
    ["Dyson HS05 Airwrap Long Lite Copper 533896-01", "airstyler"],
    ["Rowenta Brush Activ’ Ultimate Care, balta - Rotējošs matu veidotājs", "airstyler"],
    ["Remington Shine Therapy Pro S9300 matu taisnotājs", "straightener"],
    ["GA.MA Salon Curl, Waves, 160-220 °C, melna - Matu veidotājs", "curler"],
  ])("styler %s → %s", (name, expected) => {
    expect(type("styler", name, "matu-veidotaji", "styler_type")).toBe(expected);
  });

  it.each([
    ["Braun Oral-B iO3 Blush Pink", "rotating"],
    ["Philips Sonicare DiamondClean 9000 HX9911/27", "sonic"],
    ["Braun Oral-B iO Kids, Marvel Spiderman - Elektriskā zobu birste", "kids"],
    ["Oclean X Lite Blue", "sonic"],
  ])("toothbrush %s → %s", (name, expected) => {
    expect(type("toothbrush", name, "elektriskas-zobu-birstes", "brush_type")).toBe(expected);
  });

  it.each([
    ["Braun Skin i·expert, balta/rozā - Fotoepilators", "ipl"],
    ["Philips BRE237/00 epilators", "epilator"],
    ["Beurer, rozā/balta - Skuveklis sievietēm", "shaver"],
  ])("epilator %s → %s", (name, expected) => {
    expect(type("epilator", name, "epilatori", "epilator_type")).toBe(expected);
  });

  it("reads Wet & Dry and a cleaning station from the name", () => {
    const a = normaliseProduct("shaver", {
      name: "Philips Series 9000 Wet & Dry ar tīrīšanas staciju",
    }).attributes;
    expect(a.wet_dry).toBe(true);
    expect(a.clean_station).toBe(true);
  });
});

describe("personal care sanity", () => {
  it("rejects replacement blades and brush heads", () => {
    for (const [sub, name] of [
      ["shaver", "Philips OneBlade nomaināms asmens QP210/50"],
      ["toothbrush", "Oral-B zobu birstes uzgaļi EB20 4 gab."],
      ["shaver", "Braun 32B skūšanas galviņa"],
    ] as const) {
      expect(sanityCheck(sub, { name }, 2000).ok, name).toBe(false);
    }
  });

  it("accepts a trimmer sold with its comb attachments", () => {
    expect(sanityCheck("trimmer", { name: "Philips Multigroom trimmeris ar 12 uzgaļiem" }, 4500).ok).toBe(
      true,
    );
  });
});

describe("brands in personal care", () => {
  it("are not graded: no points and no grade line", () => {
    expect(gradeOf(brandTable, "Philips", "shaver")).toBeNull();
    expect(brandPoints("Philips", "shaver")).toBe(0);
    expect(brandPoints("Unknown brand", "toothbrush")).toBe(0);
    expect(gradeOf(brandTable, "Philips", "kettle")).not.toBeNull();
  });
});
