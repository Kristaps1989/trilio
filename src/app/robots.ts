import type { MetadataRoute } from "next";
import { appBaseUrl } from "@/services/payments";

// Discoverability policy: public pages are open to search engines AND to AI
// crawlers (so answers in ChatGPT, Claude, Perplexity, Google AI Overviews
// can cite Trilio's category pages). Private, transactional and tracking
// paths carry no public content and are closed to everyone.

const PRIVATE = [
  "/api/",
  "/go/",
  "/velmju-saraksts",
  "/konts",
  "/ienakt",
  "/maksajums/",
  "/rezultati",
  "/cits",
];

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
];

// Built per request: the site URL comes from APP_URL at runtime, not at build time.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = appBaseUrl();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE })),
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
