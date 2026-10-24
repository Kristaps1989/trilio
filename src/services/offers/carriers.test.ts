import { describe, expect, it } from "vitest";
import { lockerLabel, omnivaLockers, parseOmnivaLocations, resetLockerCache } from "./lockers";
import { omnivaResult, omnivaTracker, trackersFromEnv } from "./tracking";

const LOCATIONS = [
  {
    ZIP: "9595",
    NAME: "Aglonas TOP pakomāts",
    TYPE: "0",
    A0_NAME: "LV",
    A1_NAME: "Preiļu novads",
    A3_NAME: "Aglona",
    A5_NAME: "Somersētas iela",
    A7_NAME: "33",
  },
  { ZIP: "9001", NAME: "Rīga Centrs", TYPE: "0", A0_NAME: "LV", A2_NAME: "Rīga", A5_NAME: "Elizabetes iela" },
  { ZIP: "1", NAME: "Tallinna", TYPE: "0", A0_NAME: "EE", A3_NAME: "Tallinn" },
  { ZIP: "2", NAME: "Pasta nodaļa", TYPE: "1", A0_NAME: "LV", A3_NAME: "Rīga" },
  { NAME: "No zip", TYPE: "0", A0_NAME: "LV" },
];

describe("Omniva parcel lockers", () => {
  it("keeps Latvian parcel machines, sorted by city", () => {
    const list = parseOmnivaLocations(LOCATIONS);
    expect(list).toEqual([
      { id: "omniva:9595", name: "Aglonas TOP pakomāts", city: "Aglona", address: "Somersētas iela 33" },
      { id: "omniva:9001", name: "Rīga Centrs", city: "Rīga", address: "Elizabetes iela" },
    ]);
    expect(lockerLabel(list[0]!)).toBe("Aglonas TOP pakomāts — Somersētas iela 33, Aglona");
    expect(lockerLabel({ id: "x", name: "N", city: "C", address: "" })).toBe("N — C");
    expect(parseOmnivaLocations({})).toEqual([]);
  });
  it("fetches once a day and falls back to the cache or an empty list", async () => {
    resetLockerCache();
    let calls = 0;
    const ok = (async () => {
      calls++;
      return new Response(JSON.stringify(LOCATIONS));
    }) as unknown as typeof fetch;
    expect(await omnivaLockers({ fetchImpl: ok, url: "https://x.test", now: 0 })).toHaveLength(2);
    expect(await omnivaLockers({ fetchImpl: ok, url: "https://x.test", now: 1000 })).toHaveLength(2);
    expect(calls).toBe(1);
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await omnivaLockers({ fetchImpl: down, url: "https://x.test", now: 2 * 86_400_000 })).toHaveLength(
      2,
    );
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await omnivaLockers({ fetchImpl: broken, url: "https://x.test", now: 3 * 86_400_000 }),
    ).toHaveLength(2);
    const empty = (async () => new Response("[]")) as unknown as typeof fetch;
    expect(
      await omnivaLockers({ fetchImpl: empty, url: "https://x.test", now: 4 * 86_400_000 }),
    ).toHaveLength(2);
    resetLockerCache();
    expect(await omnivaLockers({ fetchImpl: broken, url: "https://x.test" })).toEqual([]);
    expect(await omnivaLockers({ fetchImpl: down, url: "https://x.test" })).toEqual([]);
  });
});

describe("Omniva tracking", () => {
  const body = {
    shipmentBarcode: "CE1",
    events: [
      { eventCode: "DELIVERED_X", eventName: "Sūtījums izsniegts", eventDate: "2026-10-20T10:00:00Z" },
      { eventCode: "IN_TRANSIT", eventName: "Ceļā", eventDate: "2026-10-19T08:00:00Z" },
    ],
  };
  it("reads delivery from the event name, or from configured codes", () => {
    expect(omnivaResult(body, [])).toEqual({
      delivered: true,
      at: new Date("2026-10-20T10:00:00Z"),
      lastEvent: "Sūtījums izsniegts",
    });
    expect(omnivaResult(body, ["OTHER"])).toMatchObject({ delivered: false, at: null });
    expect(omnivaResult({ events: [{ eventName: "Ceļā", eventDate: "nav datums" }] }, [])).toMatchObject({
      delivered: false,
      lastEvent: "Ceļā",
    });
    expect(omnivaResult({ events: [{ eventCode: "D", eventDate: "x" }] }, ["D"])).toMatchObject({
      delivered: true,
      at: null,
    });
    expect(omnivaResult(null, [])).toBeNull();
  });
  it("is on only with credentials and calls the documented endpoint", async () => {
    expect(omnivaTracker({})).toBeNull();
    expect(trackersFromEnv({})).toEqual([]);
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (u: string, init: { headers: Record<string, string> }) => {
      seen.push({ url: u, headers: init.headers });
      return new Response(JSON.stringify(body));
    }) as unknown as typeof fetch;
    const env = {
      OMNIVA_API_URL: "https://omx.test/",
      OMNIVA_USERNAME: "u",
      OMNIVA_PASSWORD: "p",
      OMNIVA_DELIVERED_EVENT_CODES: "DELIVERED_X",
    };
    const tracker = omnivaTracker(env, fetchImpl)!;
    expect(tracker.carrier).toBe("omniva");
    expect(await tracker.track("CE 1")).toMatchObject({ delivered: true });
    expect(seen[0]!.url).toBe("https://omx.test/api/v01/omx/shipments/CE%201");
    expect(seen[0]!.headers.authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    expect(seen[0]!.headers["X-Integration-Agent-Id"]).toBe("trilio");
    const failing = omnivaTracker(
      env,
      (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
    )!;
    expect(await failing.track("CE1")).toBeNull();
    const throwing = omnivaTracker(env, (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch)!;
    expect(await throwing.track("CE1")).toBeNull();
    expect(trackersFromEnv(env).map((t) => t.carrier)).toEqual(["omniva"]);
  });
});
