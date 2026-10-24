import { getTranslations } from "next-intl/server";
import type { OfferEvent } from "@/db/schema";

// The order's and offer's timeline: every step, who did it and when.

const fmt = new Intl.DateTimeFormat("lv-LV", {
  timeZone: "Europe/Riga",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export async function Timeline({
  events,
  audience = "admin",
}: {
  events: OfferEvent[];
  audience?: "admin" | "buyer";
}) {
  const t = await getTranslations("timeline");
  const shown = audience === "buyer" ? events.filter((e) => BUYER.has(e.kind)) : events;
  if (shown.length === 0) return <p className="text-[15px] text-stone">{t("none")}</p>;
  return (
    <ol className="flex flex-col gap-2 border-l-2 border-line-25 pl-4">
      {shown.map((e) => (
        <li key={e.id} className="relative text-[15px] text-mist">
          <span aria-hidden="true" className="absolute top-[7px] -left-[21px] h-2 w-2 rounded-full bg-lime" />
          <span className="font-semibold">{t.has(`kind.${e.kind}`) ? t(`kind.${e.kind}`) : e.kind}</span>
          <span className="text-stone">
            {" · "}
            {fmt.format(e.createdAt)}
            {audience === "admin"
              ? ` · ${t.has(`source.${e.source}`) ? t(`source.${e.source}`) : e.source}`
              : ""}
          </span>
          {e.kind === "shipped" && e.data?.trackingUrl ? (
            <a
              href={String(e.data.trackingUrl)}
              className="block underline underline-offset-2"
              rel="noopener noreferrer"
              target="_blank"
            >
              {String(e.data.trackingNumber ?? e.data.trackingUrl)}
            </a>
          ) : null}
          {audience === "admin" && e.note ? <span className="block text-sm text-stone">{e.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** What the buyer's own timeline shows: the steps of their order, not the admin's notes. */
const BUYER = new Set([
  "accepted",
  "paid",
  "packed",
  "shipped",
  "delivered",
  "return_requested",
  "returned",
  "refunded",
  "cancelled",
]);
