// The one door to Facebook and Instagram (docs/SOCIAL_PLAN.md §7). The real
// one talks to Meta's Graph API; the mock records what would have gone out.

export type Network = "facebook" | "instagram";

export type PublishResult = { ok: true; id: string } | { ok: false; error: string };

export type Insight = {
  reach: number;
  reactions: number;
  comments: number;
  shares: number;
  linkClicks: number;
};

/** One slide; `card` makes it a clickable card of a Facebook link carousel. */
export type CarouselImage = {
  url: string;
  alt?: string;
  card?: { link: string; name: string; description?: string; picture: string };
};

export interface SocialProvider {
  name: "meta" | "mock";
  /** A photo post: Meta fetches the image from a public URL (JPEG for Instagram). */
  publishImage(network: Network, imageUrl: string, caption: string, alt?: string): Promise<PublishResult>;
  /**
   * 2–10 images: a carousel on Instagram (no links: Instagram has none in
   * posts); on the page a link carousel, each card with its own picture,
   * headline and link, when every image carries `card`; otherwise a
   * multi-photo post.
   */
  publishCarousel(
    network: Network,
    images: CarouselImage[],
    caption: string,
    link?: string,
  ): Promise<PublishResult>;
  /**
   * The page only: a link post. Facebook draws the preview (picture, title,
   * line) from the linked page's Open Graph tags, so the whole picture is a
   * click to the site.
   */
  publishLink(link: string, caption: string): Promise<PublishResult>;
  /** A video the owner uploaded: a Reel on Instagram, a video post on the page. */
  publishVideo(network: Network, videoUrl: string, caption: string): Promise<PublishResult>;
  insights(network: Network, id: string): Promise<Insight | null>;
  remove(network: Network, id: string): Promise<boolean>;
  /** False when the token no longer works (revoked, expired), for the admin's alert. */
  tokenOk(): Promise<boolean>;
}
