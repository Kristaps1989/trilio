import { notFound } from "next/navigation";

// Any address under a language that no page claims: the branded 404 of that language.
export default function CatchAll() {
  notFound();
}
