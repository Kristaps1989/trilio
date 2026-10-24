// A stand-in for the Claude Messages API, for the e2e run only (playwright.config.ts
// points ANTHROPIC_BASE_URL here). It caches like the real API: the bytes of the
// prompt up to the cache_control marker are the key, the first request writes,
// later identical prefixes read (docs/PROMPT_CACHING_PLAN.md). It records every
// request so tests can check what the app sent.
//
// Answers: text containing "e2e-washer" routes to washers; anything else gets a
// reply that is not JSON, so the app falls back exactly as without the model.

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);
const seen = new Set();
let requests = [];

const tokens = (text) => Math.ceil(text.length / 4);

function cachedPrefix(body) {
  const system = Array.isArray(body.system) ? body.system : [];
  const marked = system.findIndex((b) => b.cache_control);
  if (marked < 0) return null;
  return JSON.stringify({ model: body.model, system: system.slice(0, marked + 1) });
}

function userText(body) {
  const content = body.messages?.at(-1)?.content;
  return typeof content === "string" ? content : (content ?? []).map((c) => c.text ?? "").join("");
}

function systemText(body) {
  const system = Array.isArray(body.system) ? body.system : [{ text: body.system ?? "" }];
  return system.map((b) => b.text ?? "").join("");
}

/** The JSON inside the wrapUntrusted tag of the user message. */
function wrapped(user) {
  const m = user.match(/^<[a-z_0-9]+>\n([\s\S]*)\n<\/[a-z_0-9]+>$/);
  return m ? m[1] : user;
}

// Answers for the ads optimiser (docs/GROWTH_PLAN.md): a few proposals built
// from the ids in the account it is given, one of them deliberately against
// the honesty rules so the e2e can see a blocked proposal; the weekly memo;
// search-term labels; creative copy.
function adsAnswer(system, user) {
  if (/weekly strategy memo/.test(system))
    return JSON.stringify({
      memo: "## Kas strādāja\n- e2e: meklēšanas kampaņas atved klikšķus uz veikaliem.\n\n## Ko apturēt\n- Nekas.",
    });
  if (system.startsWith("You manage the Google Search ads of Trilio")) {
    const account = JSON.parse(wrapped(user));
    const group = account.adGroups.find((g) => g.keywords.length > 0);
    const proposals = [];
    if (group) {
      proposals.push({
        action: "add_negative",
        campaignId: group.campaignId,
        text: "bez maksas",
        match: "phrase",
        reason: "e2e: frāze tērē bez konversijām.",
        expectedEffect: "Mazāk tukšu klikšķu.",
        confidence: 80,
      });
      proposals.push({
        action: "set_cpc",
        adGroupId: group.id,
        cpcCapCents: group.cpcCapCents + 5,
        reason: "e2e: grupa konvertē zem mērķa.",
        expectedEffect: "Vairāk parādījumu.",
        confidence: 60,
      });
      proposals.push({
        action: "new_ad",
        adGroupId: group.id,
        headlines: ["Tikai šodien", "3 piemērotākie varianti", "Salīdzini cenas veikalos"],
        descriptions: ["Atbildi uz dažiem jautājumiem.", "Secību nenosaka komisija."],
        reason: "e2e: jauna reklāma.",
        expectedEffect: "Augstāks CTR.",
        confidence: 40,
      });
    }
    return JSON.stringify({ summary: "e2e: mock kopsavilkums.", proposals });
  }
  if (system.startsWith("Label Latvian search terms")) {
    const terms = wrapped(user)
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        term: line,
        label: /remonts|rezerves|lietots/.test(line) ? "irrelevant" : "relevant",
      }));
    return JSON.stringify({ terms });
  }
  if (system.startsWith("You write Latvian display and video ad copy"))
    return JSON.stringify({
      headline: "Izvēlies bez minēšanas",
      body: "Atbildi uz dažiem jautājumiem un salīdzini cenas veikalos.",
      video: [
        { seconds: 3, onScreen: "Izvēlies bez minēšanas", visual: "Kategorijas ilustrācija" },
        { seconds: 4, onScreen: "Dažas atbildes", visual: "Jautājuma ekrāns" },
        { seconds: 4, onScreen: "3 piemērotākie varianti", visual: "Rezultātu kartītes" },
      ],
    });
  return null;
}

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const json = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.url === "/health") return json(200, { ok: true });
    if (req.url === "/__requests") return json(200, requests);
    if (req.url === "/__reset") {
      requests = [];
      seen.clear();
      return json(200, { ok: true });
    }
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages"))
      return json(404, { error: "not found" });

    const body = JSON.parse(raw || "{}");
    const prefix = cachedPrefix(body);
    const user = userText(body);
    const prefixTokens = prefix ? tokens(prefix) : 0;
    const hit = prefix !== null && seen.has(prefix);
    if (prefix) seen.add(prefix);
    const usage = {
      input_tokens: tokens(user) + (prefix ? 0 : tokens(JSON.stringify(body.system ?? ""))),
      output_tokens: 20,
      cache_creation_input_tokens: prefix && !hit ? prefixTokens : 0,
      cache_read_input_tokens: hit ? prefixTokens : 0,
    };
    const answer =
      adsAnswer(systemText(body), user) ??
      (/e2e-washer/.test(user)
        ? JSON.stringify({ subcategory: "washer", out_of_scope: false, confidence: 90, prefilled: [] })
        : "(mock: no answer)");
    requests.push({ system: body.system, user, usage });
    json(200, {
      id: `msg_mock_${requests.length}`,
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: answer }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage,
    });
  });
}).listen(PORT, "127.0.0.1");
