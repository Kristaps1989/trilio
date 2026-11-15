import library from "../../../data/social-photos.json";
import type { PeoplePhoto } from "./captions";

// The photos of people at home a post may show (data/social-photos.json, docs/SOCIAL_PLAN.md §14).
// Pure: which photo fits a category group, turn by turn.

export type LibraryPhoto = { id: string; url: string; page: string; credit: string; groups: string[] };

export const PHOTO_LIBRARY: LibraryPhoto[] = library.photos;

/**
 * The n-th photo for a category group: the ones made for the group first, then the general
 * ones ("*"), so a laundry post shows laundry and a kitchen post a kitchen. Null without any.
 */
export function pickPhoto(
  groupId: string | null | undefined,
  n: number,
  photos: LibraryPhoto[] = PHOTO_LIBRARY,
): PeoplePhoto | null {
  const own = groupId ? photos.filter((p) => p.groups.includes(groupId)) : [];
  const general = photos.filter((p) => p.groups.includes("*"));
  const pool = [...own, ...general.filter((g) => !own.includes(g))];
  if (!pool.length) return null;
  const p = pool[((n % pool.length) + pool.length) % pool.length]!;
  return { url: p.url, credit: p.credit };
}
