import { describe, expect, it } from "vitest";
import { ALLOW_ALL, crawlDelaySeconds, isAllowed, parseRobots } from "./robots";

const TEXT = `
# comment
User-agent: *
Disallow: /meklesana/
Disallow: /*utm_source=*
Allow: /meklesana/ok$
Crawl-delay: 2

User-agent: GPTBot
User-agent: OtherBot
Allow: /salidzinajums/
Disallow: /

User-agent: TrilioBot
Disallow: /private
Disallow:
`;

describe("robots.txt", () => {
  const rules = parseRobots(TEXT);

  it("applies the * group to agents without their own group", () => {
    expect(isAllowed(rules, "SomeBot", "/sadzives-tehnika/x")).toBe(true);
    expect(isAllowed(rules, "SomeBot", "/meklesana/q")).toBe(false);
    expect(isAllowed(rules, "SomeBot", "/p?utm_source=x")).toBe(false);
  });

  it("lets the longest match win, and $ anchors the end", () => {
    expect(isAllowed(rules, "SomeBot", "/meklesana/ok")).toBe(true);
    expect(isAllowed(rules, "SomeBot", "/meklesana/ok/more")).toBe(false);
  });

  it("uses only the named group when one exists, case-insensitively", () => {
    expect(isAllowed(rules, "triliobot", "/meklesana/q")).toBe(true);
    expect(isAllowed(rules, "TrilioBot", "/private/x")).toBe(false);
    expect(isAllowed(rules, "OtherBot", "/salidzinajums/a")).toBe(true);
    expect(isAllowed(rules, "OtherBot", "/anything")).toBe(false);
  });

  it("reads Crawl-delay for the matching group", () => {
    expect(crawlDelaySeconds(rules, "SomeBot")).toBe(2);
    expect(crawlDelaySeconds(rules, "TrilioBot")).toBeUndefined();
  });

  it("allows everything when robots.txt is missing", () => {
    expect(isAllowed(ALLOW_ALL, "TrilioBot", "/x")).toBe(true);
    expect(isAllowed(parseRobots(""), "TrilioBot", "/x")).toBe(true);
  });

  it("prefers allow on equal-length conflicts", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a");
    expect(isAllowed(r, "x", "/a")).toBe(true);
  });
});
