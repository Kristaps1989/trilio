// What an analytics event says about the page it happened on. Pure: built
// from the URL only, so free text, answers and other query data never leave
// the site (the `a`, `text` and `q` parameters are dropped).

export type PageInfo = {
  /** Path without query string, safe to send. */
  path: string;
  /** Site section for grouping reports ("results", "choose", "landing", …). */
  section: string;
  /** Subcategory id when the page is about one ("fridge"), else undefined. */
  subcategory?: string;
};

const SECTION_BY_FIRST_SEGMENT: Record<string, string> = {
  "": "home",
  izvelies: "choose",
  cits: "free_text",
  rezultati: "results",
  modelis: "model_check",
  kategorija: "landing",
  radars: "radar",
  ienakt: "sign_in",
  konts: "account",
  maksajums: "payment",
  noteikumi: "legal",
  privatums: "legal",
  sikdatnes: "legal",
  kontakti: "legal",
};

const ID = /^[a-z][a-z0-9_-]{0,40}$/;

export function pageInfo(pathname: string, search = ""): PageInfo {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0] ?? "";
  const section = SECTION_BY_FIRST_SEGMENT[first] ?? "other";
  let subcategory: string | undefined;
  if (first === "izvelies") subcategory = segments[2];
  else if (first === "kategorija") subcategory = segments[1];
  else if (first === "rezultati" || first === "radars")
    subcategory = new URLSearchParams(search).get("sub") ?? undefined;
  const path = "/" + segments.join("/");
  return { path, section, subcategory: subcategory && ID.test(subcategory) ? subcategory : undefined };
}

/**
 * Reads `data-ga-event` and `data-ga-param-*` from an element's dataset
 * (`{ gaEvent: "select_offer", gaParamStore: "Tet" }` →
 * `{ event: "select_offer", params: { store: "Tet" } }`).
 */
export function eventFromDataset(dataset: Record<string, string | undefined>): {
  event: string;
  params: Record<string, string>;
} | null {
  const event = dataset.gaEvent;
  if (!event || !/^[a-z][a-z0-9_]{0,39}$/.test(event)) return null;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(dataset)) {
    if (!key.startsWith("gaParam") || value === undefined) continue;
    const name = key
      .slice("gaParam".length)
      .replace(/^[A-Z]/, (c) => c.toLowerCase())
      .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (name) params[name] = value.slice(0, 100);
  }
  return { event, params };
}

/** Visible label of a clicked control, trimmed for reports. */
export function clickLabel(text: string | null | undefined, explicit?: string | null): string {
  const label = (explicit || text || "").replace(/\s+/g, " ").trim();
  return label.length > 60 ? `${label.slice(0, 59)}…` : label;
}
