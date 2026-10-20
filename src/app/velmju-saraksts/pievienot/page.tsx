import { redirect } from "next/navigation";
import { currentUserId } from "@/auth";
import { saveTarget, type SaveTarget } from "../save";

// A heart tapped while signed out: sign in, come back here, save, and return
// to the page the shopper was on (same site only). A page rather than a route
// handler, because sign-in returns here with a client-side navigation.

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/velmju-saraksts";
}

export default async function SaveAfterSignIn({ searchParams }: Props) {
  const p = await searchParams;
  const userId = await currentUserId();
  if (!userId) {
    const self = `/velmju-saraksts/pievienot?${new URLSearchParams(
      Object.entries(p).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString()}`;
    redirect(`/ienakt?callbackUrl=${encodeURIComponent(self)}`);
  }
  let target: SaveTarget | null = null;
  if (p.product && UUID.test(p.product)) target = { kind: "product", productId: p.product };
  else if (p.sub && /^[a-z]{1,40}$/.test(p.sub)) {
    target = {
      kind: "search",
      subcategoryId: p.sub,
      answersParam: (p.a ?? "").slice(0, 4000),
      label: (p.label ?? p.sub).slice(0, 300),
    };
  }
  if (target) await saveTarget(userId, target);
  redirect(safeNext(p.next));
}
