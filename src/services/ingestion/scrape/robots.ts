// robots.txt (RFC 9309). The scraper only fetches what a shop's robots.txt
// allows for our user-agent token, and honours Crawl-delay. Pure functions.

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[]; crawlDelay?: number };

export type RobotsRules = { groups: Group[] };

/** Rules that allow everything (robots.txt missing: 404/410). */
export const ALLOW_ALL: RobotsRules = { groups: [] };

export function parseRobots(text: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups };
}

/** Groups naming our token; the `*` groups only when none does (RFC 9309 §2.2.1). */
function groupsFor(rules: RobotsRules, token: string): Group[] {
  const t = token.toLowerCase();
  const named = rules.groups.filter((g) => g.agents.includes(t));
  return named.length > 0 ? named : rules.groups.filter((g) => g.agents.includes("*"));
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

/** `pathAndQuery` is the URL path plus query string, e.g. "/p/1?x=2". Longest match wins; ties allow. */
export function isAllowed(rules: RobotsRules, token: string, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const group of groupsFor(rules, token)) {
    for (const rule of group.rules) {
      if (!patternToRegex(rule.pattern).test(pathAndQuery)) continue;
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow)
      ) {
        best = rule;
      }
    }
  }
  return best ? best.allow : true;
}

/** Seconds, or undefined when the shop sets none for us. */
export function crawlDelaySeconds(rules: RobotsRules, token: string): number | undefined {
  const delays = groupsFor(rules, token)
    .map((g) => g.crawlDelay)
    .filter((d): d is number => d !== undefined);
  return delays.length ? Math.max(...delays) : undefined;
}
