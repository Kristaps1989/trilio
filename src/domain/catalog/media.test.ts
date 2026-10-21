import { describe, expect, it } from "vitest";
import { IMAGE_HOSTS } from "@/db/stores";
import { energyLabel, eprelId, hostAllowed, imageSrc } from "./media";

const hosts = ["cdn.tet.lv", "*.m79.lv", "euronics.lv", "*.euronics.lv"];

describe("hostAllowed", () => {
  it("matches exact hosts and one subdomain label for wildcards", () => {
    expect(hostAllowed("cdn.tet.lv", hosts)).toBe(true);
    expect(hostAllowed("CDN.TET.LV", hosts)).toBe(true);
    expect(hostAllowed("pictures.m79.lv", hosts)).toBe(true);
    expect(hostAllowed("www.euronics.lv", hosts)).toBe(true);
    expect(hostAllowed("euronics.lv", hosts)).toBe(true);
  });

  it("rejects other hosts, bare wildcard roots and deeper subdomains", () => {
    expect(hostAllowed("tet.lv", hosts)).toBe(false);
    expect(hostAllowed("m79.lv", hosts)).toBe(false);
    expect(hostAllowed("a.b.m79.lv", hosts)).toBe(false);
    expect(hostAllowed("evilm79.lv", hosts)).toBe(false);
    expect(hostAllowed("cdn.tet.lv.evil.com", hosts)).toBe(false);
  });
});

describe("imageSrc", () => {
  it("keeps https photos on store hosts (real URLs from the shops, 21 Oct 2026)", () => {
    for (const url of [
      "https://www.euronics.lv/UserFiles/Products/Images/412308-619773-medium.avif",
      "https://pictures.m79.lv/img/products/original/Kingston_TechnologyKF556C36BBEK2-64_1000010.webp",
      "https://cdn.tet.lv/tetveikals-prd-images/full_size/products/virtuves-kombains-sencor-stm-6377ch-15-6414286ca38be.jpg.webp",
    ])
      expect(imageSrc(url, IMAGE_HOSTS)).toBe(url);
  });

  it("drops missing, plain http, credentialed, unknown-host and malformed URLs", () => {
    expect(imageSrc(null, hosts)).toBeNull();
    expect(imageSrc("", hosts)).toBeNull();
    expect(imageSrc("http://cdn.tet.lv/a.jpg", hosts)).toBeNull();
    expect(imageSrc("https://user:pw@cdn.tet.lv/a.jpg", hosts)).toBeNull();
    expect(imageSrc("https://example.com/a.jpg", hosts)).toBeNull();
    expect(imageSrc("not a url", hosts)).toBeNull();
  });

  it("accepts only the sample data's own local files", () => {
    expect(imageSrc("/sample/kettle-steel.png", hosts)).toBe("/sample/kettle-steel.png");
    expect(imageSrc("/sample/../secret.png", hosts)).toBeNull();
    expect(imageSrc("//evil.com/sample/a.png", hosts)).toBeNull();
  });
});

describe("energyLabel", () => {
  it("links EPREL's label and Latvian sheet for a matched product", () => {
    expect(energyLabel(eprelId("refrigeratingappliances2019", "380048"), "E")).toEqual({
      energyClass: "E",
      labelUrl:
        "https://eprel.ec.europa.eu/api/products/refrigeratingappliances2019/380048/labels?format=PNG",
      sheetUrl:
        "https://eprel.ec.europa.eu/api/products/refrigeratingappliances2019/380048/fiches?language=LV",
    });
  });

  it("shows nothing without a match or a valid class", () => {
    expect(energyLabel(null, "E")).toBeNull();
    expect(energyLabel("refrigeratingappliances2019/380048", undefined)).toBeNull();
    expect(energyLabel("refrigeratingappliances2019/380048", "A+++")).toBeNull();
    expect(energyLabel("bad id", "E")).toBeNull();
    expect(energyLabel("group/../1", "E")).toBeNull();
  });
});
