import { describe, expect, it } from "vitest";
import {
  cleanValue,
  eventTime,
  forwardedChain,
  householdAddress,
  householdFigures,
  householdHash,
  householdKey,
  holdoutLift,
  pixelParams,
  tvClientFamily,
  usableSource,
} from "./tv-pixel";

describe("pixel parameters", () => {
  it("reads the macros and treats an unfilled one as absent", () => {
    const p = pixelParams(
      new URLSearchParams("vid=abc&ip=%%IP%%&ts=[timestamp]&cr=Spots 20s!&ch=TV3 LV&pos=1&grp=control"),
    );
    expect(p).toMatchObject({
      vid: "abc",
      ip: null,
      ts: null,
      cr: "Spots 20s",
      ch: "TV3 LV",
      pos: "1",
      grp: "control",
    });
    expect(pixelParams(new URLSearchParams("")).grp).toBe("ad");
    expect(pixelParams(new URLSearchParams("grp=holdout")).grp).toBe("control");
    expect(cleanValue("${CREATIVE_ID}")).toBeNull();
    expect(cleanValue("x".repeat(80))).toHaveLength(60);
  });

  it("reads FreeWheel's expanded macros and ignores ones it left unexpanded, encoded or not", () => {
    const expanded = pixelParams(
      new URLSearchParams(
        "vid=dev1&ip=81.198.1.1&ts=1794168000&cr=812345&crn=Trilio%2020s&csid=go3_lv_tv3_ctv_samsung&ch=TV3&dt=Smart%20TV&pos=midroll&ua=Mozilla%2F5.0%20(SMART-TV%3B%20Tizen%206.5)",
      ),
    );
    expect(expanded).toMatchObject({
      ip: "81.198.1.1",
      cr: "Trilio 20s",
      csid: "go3_lv_tv3_ctv_samsung",
      ch: "TV3",
      dt: "Smart TV",
      pos: "midroll",
      ua: "Mozilla/5.0 (SMART-TV; Tizen 6.5)",
    });
    const left = pixelParams(
      new URLSearchParams(
        "ip=#{request.clientAddress}&cr=#{ad.creative.id}&crn=#e{ad.creative.name}&csid=#e{section.customId}&dt=#s{sa.platform.deviceType}&ua=#e{request.userAgent}&pos=#2{slot.timePositionClass}",
      ),
    );
    expect(left).toMatchObject({ ip: null, cr: null, csid: null, dt: null, ua: null, pos: null });
    // Go3's site section by its name when the custom id is not the DAI_… form; positions normalised.
    expect(
      pixelParams(new URLSearchParams("csid=48213&ss=DAI_smarttv_other_PR_TV3_LV_HD_HVC&pos=Midroll")),
    ).toMatchObject({ csid: "DAI_smarttv_other_PR_TV3_LV_HD_HVC", pos: "midroll" });
    // Country, opt-out, spot length, programme, genre, daypart, placement and id type.
    expect(
      pixelParams(
        new URLSearchParams(
          "co=lv&lat=1&dur=20.0&pg=&ast=Degpunkt%C4%81&gn=News&dp=Prime&pl=Trilio%20Go3%20LV&idt=TIFA",
        ),
      ),
    ).toMatchObject({
      country: "LV",
      optOut: true,
      dur: "20",
      program: "Degpunktā",
      genre: "News",
      daypart: "Prime",
      placement: "Trilio Go3 LV",
      idType: "tifa",
    });
    const none = pixelParams(
      new URLSearchParams(
        'co=#{request.country}&lat=#{request.deviceOptOut}&dur=#{ad.creative.rendition.duration}&pg=#e{series.title}&idt=#{request.deviceIdType("iab")}',
      ),
    );
    expect(none).toMatchObject({ country: null, optOut: false, dur: null, program: null, idType: null });
    // The creative's id stands in when its name is not given.
    expect(pixelParams(new URLSearchParams("cr=812345")).cr).toBe("812345");
  });

  it("takes the ad event's own time only when it is plausible", () => {
    const now = new Date("2026-11-08T20:00:00Z");
    expect(eventTime("1794168000", now)?.toISOString()).toBe("2026-11-08T20:00:00.000Z");
    expect(eventTime("1794167400000", now)?.toISOString()).toBe("2026-11-08T19:50:00.000Z");
    expect(eventTime("2026-11-08T19:59:00Z", now)?.toISOString()).toBe("2026-11-08T19:59:00.000Z");
    expect(eventTime("2026-11-08T17:00:00Z", now)).toBeNull(); // 3 h late
    expect(eventTime("2026-11-08T20:30:00Z", now)).toBeNull(); // in the future
    expect(eventTime("nonsense", now)).toBeNull();
  });
});

describe("household addresses", () => {
  it("keeps public addresses, cuts IPv6 to its /64 and refuses private ones", () => {
    expect(householdKey("81.198.10.20")).toBe("81.198.10.20");
    expect(householdKey("81.198.10.20:5555")).toBe("81.198.10.20");
    expect(householdKey("2a02:1234:abcd:ef01:1111:2222:3333:4444")).toBe("2a02:1234:abcd:ef01::/64");
    expect(householdKey("[2a02:1234:abcd:ef01::9]:443")).toBe("2a02:1234:abcd:ef01::/64");
    for (const ip of [
      "10.0.0.1",
      "192.168.1.5",
      "172.20.0.1",
      "127.0.0.1",
      "100.64.1.1",
      "::1",
      "fd00::1",
      "2001:db8::1",
      "x",
    ])
      expect(householdKey(ip), ip).toBeNull();
  });

  it("prefers the macro, then the device header, then a forwarded chain of two or more", () => {
    expect(householdAddress({ macroIp: "81.1.1.1", deviceIp: "81.2.2.2", xff: "81.3.3.3, 5.5.5.5" })).toEqual(
      {
        key: "81.1.1.1",
        source: "macro",
      },
    );
    expect(householdAddress({ macroIp: null, deviceIp: "81.2.2.2", xff: null })?.source).toBe("header");
    expect(householdAddress({ macroIp: null, deviceIp: null, xff: "81.3.3.3, 5.5.5.5" })).toEqual({
      key: "81.3.3.3",
      source: "forwarded",
    });
    // One hop is the ad server itself: not a household.
    expect(householdAddress({ macroIp: null, deviceIp: null, xff: "5.5.5.5" })).toBeNull();
    expect(forwardedChain(" a , b ,, c")).toEqual(["a", "b", "c"]);
  });

  it("hashes a household per campaign, never the same across campaigns", () => {
    expect(householdHash("s1", "81.1.1.1")).toBe(householdHash("s1", "81.1.1.1"));
    expect(householdHash("s1", "81.1.1.1")).not.toBe(householdHash("s2", "81.1.1.1"));
    expect(householdHash("s1", "81.1.1.1")).not.toContain("81");
  });

  it("uses forwarded addresses only when they are many, never an ad server's few", () => {
    expect(
      usableSource({ reach: 1000, distinct: { macro: 3 }, forwarded: 0, impressions: 1200 }).source,
    ).toBe("macro");
    expect(
      usableSource({ reach: 1000, distinct: { device: 900 }, forwarded: 0, impressions: 1200 }).source,
    ).toBe("header");
    expect(
      usableSource({ reach: 1000, distinct: { xff0: 700 }, forwarded: 1200, impressions: 1200 }).source,
    ).toBe("forwarded");
    expect(usableSource({ reach: 1000, distinct: { xff0: 4 }, forwarded: 1200, impressions: 1200 })).toEqual({
      source: null,
      reason: "few",
    });
    expect(usableSource({ reach: 1000, distinct: {}, forwarded: 0, impressions: 1200 })).toEqual({
      source: null,
      reason: "none",
    });
  });
});

describe("TV device families", () => {
  it("names TVs, boxes and server software coarsely", () => {
    expect(tvClientFamily("Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36")).toBe(
      "Samsung Tizen",
    );
    expect(tvClientFamily("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36")).toBe("LG webOS");
    expect(tvClientFamily("Dalvik/2.1.0 (Linux; U; Android 11; BRAVIA 4K VH2)")).toBe("Android TV");
    expect(tvClientFamily("okhttp/4.9.3")).toBe("server: okhttp");
    expect(tvClientFamily("Go-http-client/1.1")).toBe("server: Go");
    expect(tvClientFamily(null)).toBe("—");
  });
});

describe("household view-through", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 8, 19, 0) + m * 60_000);
  it("counts a visit 0–20 minutes after an exposure as direct, and within 7 days as the week", () => {
    const f = householdFigures(
      [
        { household: "a", at: at(0), grp: "ad" },
        { household: "b", at: at(0), grp: "ad" },
        { household: "c", at: at(0), grp: "ad" },
        { household: "d", at: at(0), grp: "ad" },
        { household: "x", at: at(0), grp: "control" },
        { household: "y", at: at(0), grp: "control" },
      ],
      [
        { household: "a", at: at(5) }, // direct
        { household: "b", at: at(60 * 24 * 3) }, // three days later
        { household: "c", at: at(-10) }, // before the spot: not counted
        { household: "x", at: at(60 * 30) }, // holdout, within the week
        { household: "z", at: at(1) }, // never exposed
      ],
    );
    expect(f).toEqual({ exposed: 4, direct: 1, week: 2, control: 2, controlDirect: 0, controlWeek: 1 });
  });

  it("gives the holdout lift with its interval, and none without a holdout visit", () => {
    const l = holdoutLift(1000, 60, 200, 6)!;
    expect(l.lift).toBe(1);
    expect(l.low).toBeLessThan(l.lift);
    expect(l.high).toBeGreaterThan(l.lift);
    expect(holdoutLift(1000, 60, 200, 0)).toBeNull();
    expect(holdoutLift(1000, 60, 0, 0)).toBeNull();
  });
});
