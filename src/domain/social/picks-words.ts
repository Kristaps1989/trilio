// Words every picture of three picks shares (the posts, the ads and the Reels): the tagline, the
// tiers and the recommended pick. A module of its own so the captions and the scenes
// (reel-script.ts) both read it without importing each other.

/** The fields of a pick these words need (captions.ts PickLine has them all). */
type Ranked = { recommended?: boolean };

export const TAGLINE = "Daži jautājumi. 3 ieteikumi. Pērc uzreiz vai pajautā zemāku cenu.";
export const TIER_NAME = { budget: "Budžeta variants", mid: "Vidējā klase", top: "Augstākā klase" } as const;
export const BEST_LABEL = "Labākā izvēle";

/** The pick the site recommends ("Labākā izvēle"); the first when the ranking marks none. */
export function bestPick<T extends Ranked>(picks: T[]): T {
  return picks.find((p) => p.recommended) ?? picks[0]!;
}
