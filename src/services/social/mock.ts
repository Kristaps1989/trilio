import { createHash, randomUUID } from "node:crypto";
import type { Network, SocialProvider } from "./provider";

// A stand-in for Meta (SOCIAL_PROVIDER=mock): every post "succeeds" and is
// kept in memory, so dev runs and the e2e suite can see what would have gone out.

export type MockPost = {
  network: Network;
  id: string;
  media: string;
  caption: string;
  removed: boolean;
  alts?: string[];
};

const store = globalThis as unknown as { __trilioSocialMock?: MockPost[] };
export const mockPosts = (): MockPost[] => (store.__trilioSocialMock ??= []);

const n = (seed: string, max: number) =>
  createHash("sha256").update(seed).digest().readUInt32BE(0) % (max + 1);

export function mockSocialProvider(): SocialProvider {
  const add = (network: Network, media: string, caption: string, alts?: string[]) => {
    const id = `mock_${network}_${randomUUID().slice(0, 8)}`;
    mockPosts().push({ network, id, media, caption, removed: false, alts });
    return { ok: true as const, id };
  };
  return {
    name: "mock",
    async publishImage(network, imageUrl, caption, alt) {
      return add(network, imageUrl, caption, alt ? [alt] : undefined);
    },
    async publishCarousel(network, images, caption) {
      return add(
        network,
        images.map((i) => i.url).join(" "),
        caption,
        images.map((i) => i.alt ?? ""),
      );
    },
    async publishVideo(network, videoUrl, caption) {
      return add(network, videoUrl, caption);
    },
    async insights(_network, id) {
      return {
        reach: 200 + n(id, 800),
        reactions: n(`${id}r`, 40),
        comments: n(`${id}c`, 5),
        shares: n(`${id}s`, 3),
        linkClicks: n(`${id}l`, 25),
      };
    },
    async remove(_network, id) {
      const p = mockPosts().find((x) => x.id === id);
      if (p) p.removed = true;
      return !!p;
    },
    async tokenOk() {
      return true;
    },
  };
}
