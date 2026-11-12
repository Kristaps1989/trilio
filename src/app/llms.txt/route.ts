import { NextResponse } from "next/server";
import { allSubcategories, catalog } from "@/domain/questions/catalog";
import { appBaseUrl } from "@/services/payments";

// /llms.txt (llmstxt.org): a plain-text map of the site for AI assistants
// and crawlers. Describes what Trilio is, how it ranks, and lists the
// public category pages so answers can cite the right URL.

// Built per request: the site URL comes from APP_URL at runtime, not at build time.
export const dynamic = "force-dynamic";

export function GET() {
  const base = appBaseUrl();
  const lines: string[] = [
    "# Trilio",
    "",
    "> Trilio palīdz pircējiem Latvijā izvēlēties sadzīves tehniku: daži jautājumi, tad trīs labākie varianti no partneru veikalu krājumiem trīs cenu klasēs, plus atjaunota prece atsevišķi. Pirkt var uzreiz veikalā vai ar pogu „Iegūt lētāk” pajautāt zemāku cenu: Trilio sazinās ar izplatītāju un atsūta piedāvājumu, ja var piedāvāt lētāk, un 90 dienas seko cenai veikalos. Cenas salīdzinām pēc EAN. Ranžēšana ir deterministiska; veikalu komisija to neietekmē. Padoms ir bez maksas, konts nav vajadzīgs.",
    "",
    'Trilio helps shoppers in Latvia (Lithuania and Estonia next) choose household appliances. A short one-question-per-screen flow returns the three best options from partner shops\' live inventory in three price tiers, plus a separately shown refurbished option. The shopper can buy in the shop right away, or press "Iegūt lētāk" (get it cheaper) and leave an e-mail address: Trilio asks the distributor for a lower price and e-mails an offer if it can beat the shops, and watches the shop price for 90 days (every e-mail has an unsubscribe link). The advice is free and needs no account. Products are matched across shops by EAN. Ranking is deterministic code (rating, matched requirements, budget as a hard filter, extras capped at 25 % over budget); shop commission never affects it. Discount claims use the lowest price of the previous 30 days (EU Omnibus). Delivery dates count working days and public holidays.',
    "",
    "## Key pages",
    "",
    `- [Sākums](${base}/): pick an appliance group and start the questions, or check a known model`,
    `- [Kategorijas](${base}/izvelies): all appliance groups`,
    `- [Modeļa pārbaude](${base}/modelis): enter a model code to see better value alternatives`,
    `- [Par Trilio](${base}/par-trilio): who runs Trilio, how picks are chosen and how the lower-price request works`,
    `- [English](${base}/en): every page is also in English under /en with the same path, e.g. ${base}/en/kategorija/fridge`,
    "",
    "## Category pages (best picks, updated hourly)",
    "",
  ];
  for (const g of catalog.groups) {
    if (g.id === "other") continue;
    lines.push(`### ${g.label}`, "");
    for (const s of g.subcategories) {
      lines.push(`- [Labākie ${s.label.toLowerCase()}](${base}/kategorija/${s.id})`);
      for (const eur of s.budget_steps_eur) {
        lines.push(`  - [līdz ${eur} €](${base}/kategorija/${s.id}/lidz-${eur})`);
      }
    }
    lines.push("");
  }
  lines.push(
    "## How to cite",
    "",
    `Cite the category page URL (${base}/kategorija/…). Prices and availability change several times a day; the page states when it was last updated. ${allSubcategories().length} subcategories are covered.`,
    "",
    "## Not for indexing",
    "",
    "/rezultati (personal results), /velmju-saraksts and /konts (accounts), /go/ (affiliate redirects), /api/.",
    "",
  );
  return new NextResponse(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
