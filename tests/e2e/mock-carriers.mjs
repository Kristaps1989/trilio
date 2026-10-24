// A stand-in for Omniva's public locations file, for the e2e run only
// (playwright.config.ts points OMNIVA_LOCATIONS_URL here), so checkout's
// parcel-locker list never depends on a carrier's server.

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_CARRIERS_PORT ?? 4011);
const LOCATIONS = [
  {
    ZIP: "9001",
    NAME: "Rīga Centrs pakomāts",
    TYPE: "0",
    A0_NAME: "LV",
    A3_NAME: "Rīga",
    A5_NAME: "Elizabetes iela",
    A7_NAME: "10",
  },
  {
    ZIP: "9002",
    NAME: "Imanta Maxima pakomāts",
    TYPE: "0",
    A0_NAME: "LV",
    A3_NAME: "Rīga",
    A5_NAME: "Kurzemes prospekts",
    A7_NAME: "1",
  },
  {
    ZIP: "9003",
    NAME: "Jelgava Pilsēta pakomāts",
    TYPE: "0",
    A0_NAME: "LV",
    A3_NAME: "Jelgava",
    A5_NAME: "Lielā iela",
    A7_NAME: "2",
  },
  { ZIP: "1001", NAME: "Tallinn", TYPE: "0", A0_NAME: "EE", A3_NAME: "Tallinn" },
];

createServer((req, res) => {
  const json = (status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (req.url === "/health") return json(200, { ok: true });
  if (req.url === "/locations.json") return json(200, LOCATIONS);
  return json(404, { error: "not found" });
}).listen(PORT, "127.0.0.1");
