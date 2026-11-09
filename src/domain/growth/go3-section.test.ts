import { describe, expect, it } from "vitest";
import { deviceLabel, isGo3Section, parseSection, prettyChannel } from "./go3-section";

// The owner's examples from real Go3 Go exports (9 Nov 2026).

describe("Go3 site section", () => {
  it("reads device, environment, content type and channel", () => {
    expect(parseSection("DAI_smarttv_other_PR_TV3_EE_HD_HVC")).toMatchObject({
      device: "smarttv",
      environment: "other",
      type: "LIVE",
      channel: "TV3",
      screen: "tv",
    });
    expect(parseSection("DAI_browser_other_PR_Kanal2_HD_HVC")).toMatchObject({
      type: "LIVE",
      channel: "Kanal2",
      screen: "desktop",
    });
    expect(parseSection("DAI_android_mobile_PR_TV3_Life_LV_HD_HVC")).toMatchObject({
      device: "android",
      environment: "mobile",
      channel: "TV3 Life",
      screen: "mobile",
    });
    expect(parseSection("DAI_ios_mobile_PR_TV3_EE_HD_HVC").screen).toBe("mobile");
    expect(parseSection("DAI_smarttv_other_Go3_CATCHUP")).toMatchObject({ type: "CATCHUP", channel: null });
    expect(parseSection("DAI_browser_other_Go3_VOD")).toMatchObject({ type: "VOD", channel: null });
  });

  it("cleans channel names and keeps working on unknown or odd values", () => {
    expect(prettyChannel("PR_ETV_Plus_HD_HVC")).toBe("ETV Plus");
    expect(prettyChannel("PR_TV3_Gold_EE_HVC")).toBe("TV3 Gold");
    expect(prettyChannel("PR_TV6_3plus_HD")).toBe("TV6 3+");
    expect(parseSection("smarttv_other_PR_LTV1_HD")).toMatchObject({ device: "smarttv", channel: "LTV1" });
    expect(parseSection("garbage")).toMatchObject({ device: "other", type: "LIVE", screen: "other" });
    expect(parseSection(null).device).toBe("other");
    expect(deviceLabel("smarttv")).toBe("Smart TV");
    expect(deviceLabel("vidaa")).toBe("Vidaa");
    expect(isGo3Section("DAI_ios_mobile_Go3_VOD")).toBe(true);
    expect(isGo3Section("1234")).toBe(false);
  });
});
