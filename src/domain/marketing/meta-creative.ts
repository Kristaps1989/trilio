import type { PickLine } from "@/domain/social/captions";
import { formatEur } from "@/i18n/format";
import type { AdFormat } from "./ad-pages";

// The Meta ads the agent makes itself (owner, 24 Nov 2026: the agent creates and publishes
// ads on its own). One kind of ad: a category's three picks at today's prices, drawn like the
// page's own posts, leading to that category's three picks on the site. Pure rules: which
// categories get an ad, what the ad says, and when an ad no longer tells the truth.

/** The agent's own campaign. Lower-case and plain, so the link's campaign tag carries it unchanged. */
export const AGENT_CAMPAIGN = "trilio-ai-epasti";
export const AGENT_ADSET = "latvija";
/**
 * At most this many categories are advertised at once, each with its four ads (ad-pages.ts:
 * two pictures, a carousel, a Reel): every category needs spend of its own to show a result.
 */
export const MAX_AGENT_ADS = 2;
/** One advertised category per this much of Meta's daily share. */
export const CENTS_PER_AD = 100;
/** New ads made in one day, replacements included: two categories' four formats. */
export const MAX_NEW_ADS_PER_DAY = 8;

const FORMAT_TAG: Record<AdFormat, string> = {
  collage: "a",
  collage_b: "b",
  carousel: "karusele",
  reel: "reel",
};

/** "fridge-a-20261127": the ad's name, and its tag in the link. */
export function adName(subcategoryId: string, day: string, format: AdFormat = "collage"): string {
  return `${subcategoryId}-${FORMAT_TAG[format]}-${day.replace(/-/g, "")}`;
}

/** Where the ad leads: the category's three picks, tagged so Trilio knows the campaign and the ad. */
export function adLink(baseUrl: string, subcategoryId: string, name: string): string {
  const q = new URLSearchParams({
    sub: subcategoryId,
    cena: "tipiska",
    utm_source: "meta",
    utm_medium: "paid_social",
    utm_campaign: AGENT_CAMPAIGN,
    utm_content: name,
  });
  return `${baseUrl.replace(/\/$/, "")}/rezultati?${q.toString()}`;
}

/**
 * What an ad shows. `look` is the picture's version: an ad drawn before the current one (no
 * `look`, or a lower one) is replaced like an ad whose prices changed.
 */
export type AdFacts = {
  look?: number;
  category: string;
  picks: Pick<PickLine, "name" | "priceCents" | "shop">[];
};

/**
 * 3: the four formats, pictures shaped per placement (27 Nov 2026); 2: the square photo
 * collage; 1 (unset): the dark list without photos.
 */
export const AD_LOOK = 3;

/**
 * The ad's words: what the three are and what they cost today, then what Trilio does. No
 * urgency, no "cheapest", no discount: the prices are the shops' prices as they stand.
 */
export function adText(f: AdFacts): { message: string; headline: string; description: string } {
  const lines = f.picks.map((p) => `• ${p.name}: ${formatEur(p.priceCents, "lv")}`);
  return {
    message: [
      `${f.category}: 3 piemēroti varianti šodienas cenās.`,
      lines.join("\n"),
      "Atbildi uz dažiem jautājumiem un redzi savus trīs. Vari arī pajautāt zemāku cenu.",
    ].join("\n\n"),
    headline: `${f.category}: 3 piemēroti varianti`.slice(0, 60),
    description: "Cenas partneru veikalos",
  };
}

/** An ad tells the truth while its three products and their prices are what the site shows now. */
export function factsChanged(shown: AdFacts, now: AdFacts): boolean {
  if ((shown.look ?? 1) !== (now.look ?? 1)) return true;
  if (shown.picks.length !== now.picks.length) return true;
  return shown.picks.some(
    (p, i) => p.name !== now.picks[i]!.name || p.priceCents !== now.picks[i]!.priceCents,
  );
}

export type CategoryFunnel = { subcategoryId: string; resultsVisitors: number; sent: number; taps: number };

/**
 * The categories worth an ad, best first: where visitors of the results page leave e-mails (and,
 * before any e-mail, tap the request), smoothed so that three visitors and one e-mail do not
 * outrank a category seen by a hundred. Only categories that can show three picks today.
 */
export function categoriesToAdvertise(
  funnel: CategoryFunnel[],
  available: Set<string>,
  shareCents: number,
): string[] {
  const slots = Math.min(MAX_AGENT_ADS, Math.floor(shareCents / CENTS_PER_AD));
  if (slots <= 0) return [];
  const score = (f: CategoryFunnel) => (f.sent * 3 + f.taps + 0.5) / (f.resultsVisitors + 20);
  return funnel
    .filter((f) => available.has(f.subcategoryId))
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        b.resultsVisitors - a.resultsVisitors ||
        a.subcategoryId.localeCompare(b.subcategoryId),
    )
    .slice(0, slots)
    .map((f) => f.subcategoryId);
}

// ---------------------------------------------------------------------------------------------
// The ads' creatives as Meta's API takes them (developers.facebook.com, Marketing API: ad
// creative, placement asset customization, carousel and video ads; read 27 Nov 2026).

type Json = Record<string, unknown>;
type Speaker = { pageId: string; instagramUserId?: string | null };
type Words = { link: string; message: string; headline: string; description: string };

const storySpec = (s: Speaker, extra: Json = {}): Json => ({
  page_id: s.pageId,
  ...(s.instagramUserId ? { instagram_user_id: s.instagramUserId } : {}),
  ...extra,
});
const learnMore = (link: string) => ({ type: "LEARN_MORE", value: { link } });

/** One picture everywhere: the square one. What a placement-shaped ad falls back to. */
export function imageCreative(s: Speaker, w: Words, imageHash: string, name: string): Json {
  return {
    name,
    object_story_spec: storySpec(s, {
      link_data: {
        link: w.link,
        message: w.message,
        name: w.headline,
        description: w.description,
        image_hash: imageHash,
        call_to_action: learnMore(w.link),
      },
    }),
  };
}

/**
 * One picture per kind of placement: 4:5 in the feeds, 9:16 in the stories, the square one
 * elsewhere. Meta's placement asset customization: the pictures carry labels and each rule
 * names the placements that show its label.
 */
export function placementCreative(
  s: Speaker,
  w: Words,
  hashes: { square: string; portrait: string; story: string },
  name: string,
): Json {
  return {
    name,
    object_story_spec: storySpec(s),
    asset_feed_spec: {
      ad_formats: ["SINGLE_IMAGE"],
      optimization_type: "PLACEMENT",
      images: [
        { hash: hashes.portrait, adlabels: [{ name: "feed" }] },
        { hash: hashes.story, adlabels: [{ name: "story" }] },
        { hash: hashes.square, adlabels: [{ name: "square" }] },
      ],
      bodies: [{ text: w.message }],
      titles: [{ text: w.headline }],
      descriptions: [{ text: w.description }],
      link_urls: [{ website_url: w.link }],
      call_to_action_types: ["LEARN_MORE"],
      asset_customization_rules: [
        {
          customization_spec: {
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["feed", "marketplace", "video_feeds"],
            instagram_positions: ["stream", "explore", "explore_home", "profile_feed"],
          },
          image_label: { name: "feed" },
        },
        {
          customization_spec: {
            publisher_platforms: ["facebook", "instagram", "messenger"],
            facebook_positions: ["story"],
            instagram_positions: ["story"],
            messenger_positions: ["story"],
          },
          image_label: { name: "story" },
        },
        {
          customization_spec: {
            publisher_platforms: ["facebook", "instagram", "audience_network"],
            facebook_positions: ["right_hand_column", "search"],
            instagram_positions: ["ig_search"],
            audience_network_positions: ["classic"],
          },
          image_label: { name: "square" },
        },
      ],
    },
  };
}

/**
 * The three products as a carousel, in the order of their tiers (so not re-ordered by Meta),
 * each card its photo, name and price, every card leading to the category's three picks.
 */
export function carouselCreative(
  s: Speaker,
  w: Words,
  cards: { imageHash: string; name: string; description: string }[],
  name: string,
): Json {
  return {
    name,
    object_story_spec: storySpec(s, {
      link_data: {
        link: w.link,
        message: w.message,
        multi_share_optimized: false,
        multi_share_end_card: false,
        child_attachments: cards.map((c) => ({
          link: w.link,
          image_hash: c.imageHash,
          name: c.name,
          description: c.description,
          call_to_action: learnMore(w.link),
        })),
      },
    }),
  };
}

/** The Reel: the video, its first picture as the thumbnail, the same words and button. */
export function videoCreative(s: Speaker, w: Words, videoId: string, thumbHash: string, name: string): Json {
  return {
    name,
    object_story_spec: storySpec(s, {
      video_data: {
        video_id: videoId,
        image_hash: thumbHash,
        message: w.message,
        title: w.headline,
        link_description: w.description,
        call_to_action: learnMore(w.link),
      },
    }),
  };
}
