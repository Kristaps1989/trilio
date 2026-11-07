import type { MetadataRoute } from "next";
import { appBaseUrl } from "@/services/payments";

// Discoverability policy: public pages are open to search engines AND to AI
// crawlers (so answers in ChatGPT, Claude, Perplexity, Google AI Overviews
// can cite Trilio's category pages). Private, transactional and tracking
// paths carry no public content and are closed to everyone.

const PRIVATE = [
  "/api/",
  "/go/",
  "/pirms-veikala/",
  "/px/",
  "/tv/",
  "/velmju-saraksts",
  "/konts",
  "/ienakt",
  "/maksajums/",
  "/rezultati",
  "/cits",
  "/admin",
  "/piedavajums/",
  "/piedavajumi/",
  "/pasutijums/",
];

/**
 * Link-preview crawlers (Facebook, Messenger, WhatsApp, LinkedIn, X, Slack,
 * Telegram, Discord): they read a shared page's Open Graph tags and fetch its
 * picture, and honour robots.txt while doing so. Post pictures are open to
 * them (and to everyone) even under /api/, for previews cached with the old address.
 */
const PREVIEW_CRAWLERS = [
  "facebookexternalhit",
  "Facebot",
  "meta-externalagent",
  "WhatsApp",
  "LinkedInBot",
  "Twitterbot",
  "Slackbot-LinkExpanding",
  "TelegramBot",
  "Discordbot",
];

/** Public pictures under /api/: social post images (Meta fetches them; previews show them). */
const PUBLIC_API = ["/api/social/"];

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
      { userAgent: "*", allow: ["/", ...PUBLIC_API], disallow: PRIVATE },
      { userAgent: PREVIEW_CRAWLERS, allow: ["/", ...PUBLIC_API], disallow: PRIVATE },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: ["/", ...PUBLIC_API], disallow: PRIVATE })),
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
