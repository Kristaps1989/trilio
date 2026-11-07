import { describe, expect, it } from "vitest";
import { askAnswered, ASK_TTL_MS, cookieValue } from "./ask-cookie";
import { clickSuspicion, sendsFetchMetadata, signalsOf, type ClickSignals } from "./click-quality";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const OLD_CHROME =
  "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.77 Safari/537.36";
const SAFARI_IOS_17 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const SAFARI_IOS_15 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";
const CHROME_IOS_15 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

const page: ClickSignals = {
  site: "same-origin",
  mode: "navigate",
  user: true,
  referrerHost: "trilio.lv",
  lang: "lv",
};
const none: ClickSignals = { site: null, mode: null, user: null, referrerHost: null, lang: null };

describe("signals", () => {
  it("keeps the fetch metadata, the referrer's host only and the first language", () => {
    const s = signalsOf(
      new Headers({
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-user": "?1",
        referer: "https://trilio.lv/rezultati?sub=kettle&a=secret",
        "accept-language": "lv-LV,lv;q=0.9,en;q=0.8",
      }),
    );
    expect(s).toEqual({
      site: "same-origin",
      mode: "navigate",
      user: true,
      referrerHost: "trilio.lv",
      lang: "lv-LV",
    });
    expect(signalsOf(new Headers())).toEqual(none);
    expect(signalsOf(new Headers({ referer: "not a url" })).referrerHost).toBeNull();
  });
});

describe("browsers that always send fetch metadata", () => {
  it("knows modern Chromium, Firefox and Safari, and spares older or unknown agents", () => {
    expect(sendsFetchMetadata(CHROME_WIN)).toBe(true);
    expect(sendsFetchMetadata(FIREFOX)).toBe(true);
    expect(sendsFetchMetadata(SAFARI_IOS_17)).toBe(true);
    expect(sendsFetchMetadata(OLD_CHROME)).toBe(false);
    expect(sendsFetchMetadata(SAFARI_IOS_15)).toBe(false);
    expect(sendsFetchMetadata(CHROME_IOS_15)).toBe(false);
    expect(sendsFetchMetadata("SomeApp/1.0")).toBe(false);
    expect(sendsFetchMetadata(null)).toBe(false);
  });
});

describe("a suspect click", () => {
  it("is a modern browser's user agent without fetch metadata", () => {
    expect(clickSuspicion({ userAgent: CHROME_WIN, signals: none, source: "card", pageViewed: true })).toBe(
      "no_fetch_meta",
    );
    // An old browser without the headers is a person until shown otherwise.
    expect(
      clickSuspicion({ userAgent: OLD_CHROME, signals: none, source: "card", pageViewed: true }),
    ).toBeNull();
  });
  it("is a link from a Trilio page that arrived from elsewhere", () => {
    const cross = { ...page, site: "cross-site", referrerHost: "outlook.office.com" };
    expect(clickSuspicion({ userAgent: CHROME_WIN, signals: cross, source: "card", pageViewed: true })).toBe(
      "not_from_page",
    );
    expect(
      clickSuspicion({
        userAgent: CHROME_WIN,
        signals: { ...page, site: "none" },
        source: "ask",
        pageViewed: true,
      }),
    ).toBe("not_from_page");
    // An old link without a source (e-mails before 2 Nov 2026) may come from anywhere.
    expect(
      clickSuspicion({ userAgent: CHROME_WIN, signals: cross, source: null, pageViewed: true }),
    ).toBeNull();
  });
  it("is a click by a visitor who never showed a page that day", () => {
    expect(clickSuspicion({ userAgent: CHROME_WIN, signals: page, source: "card", pageViewed: false })).toBe(
      "no_page_view",
    );
  });
  it("is not a person clicking on a Trilio page", () => {
    expect(
      clickSuspicion({ userAgent: CHROME_WIN, signals: page, source: "card", pageViewed: true }),
    ).toBeNull();
    expect(
      clickSuspicion({ userAgent: SAFARI_IOS_17, signals: page, source: "ask", pageViewed: true }),
    ).toBeNull();
  });
});

describe("the answer cookie", () => {
  const now = Date.UTC(2026, 10, 7, 12);
  it("holds an answer for 24 hours", () => {
    expect(askAnswered(String(now - 1000), now)).toBe(true);
    expect(askAnswered(String(now - ASK_TTL_MS + 1), now)).toBe(true);
    expect(askAnswered(String(now - ASK_TTL_MS), now)).toBe(false);
    expect(askAnswered(String(now + 3_600_000), now)).toBe(false);
    expect(askAnswered("x", now)).toBe(false);
    expect(askAnswered(null, now)).toBe(false);
  });
  it("is read from a Cookie header", () => {
    expect(cookieValue("a=1; trilio_ask=123; b=2")).toBe("123");
    expect(cookieValue("trilio_asker=1")).toBeNull();
    expect(cookieValue(null)).toBeNull();
  });
});
