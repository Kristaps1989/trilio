import { NextResponse } from "next/server";
import { db } from "@/db";
import { loadCandidates } from "@/db/queries/catalog";
import { decodeState, priceRange } from "@/domain/flow/state";
import { getSubcategory } from "@/domain/questions/catalog";
import { countMatches } from "@/domain/ranking/rank";
import { relaxations } from "@/domain/ranking/relax";

// Live "Atbilst N" counts for flow screens and results-page filter sheets
// (docs/FILTERS_PLAN.md §2.6): the same countMatches the results use, so the
// number on the button is the number of products the next page shows. When
// nothing fits, the first relax suggestion comes with it ("paplašināt līdz …").

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sub = getSubcategory(url.searchParams.get("sub") ?? "");
  if (!sub) return NextResponse.json({ error: "unknown subcategory" }, { status: 400 });
  const state = decodeState(sub, url.searchParams.get("a"));
  const products = await loadCandidates(db, sub.id);
  const input = {
    products,
    sub,
    answers: state.answers,
    budget: priceRange(state),
    urgency: state.trailing.urgency ?? "two_weeks",
    brands: state.trailing.brands,
    brandsOnly: state.trailing.brandsOnly,
    showUnknown: state.trailing.showUnknown,
  } as const;
  const count = countMatches(input);
  const suggestion = count === 0 ? (relaxations(input, 1)[0] ?? null) : null;
  return NextResponse.json({ count, suggestion }, { headers: { "cache-control": "no-store" } });
}
