import { createHash, createHmac, randomBytes } from "node:crypto";

// Paysera MAC authentication (OAuth 2.0 MAC token style), as documented at
// developers.paysera.com/guides/wallet/authentication and used by the
// Checkout / Recurring Billing API:
//
//   normalized = ts \n nonce \n METHOD \n request-uri \n host \n 443 \n ext \n
//   mac        = base64(HMAC-SHA256(mac_key, normalized))
//   ext        = "body_hash=" + urlencode(base64(sha256(body)))   (only with a body)
//   header     = MAC id="…", ts="…", nonce="…", mac="…", ext="…"

export type MacCredentials = { macId: string; macKey: string };

export function bodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("base64");
}

export function buildExt(body: string | null, extra: Record<string, string> = {}): string {
  const parts: string[] = [];
  if (body !== null && body !== "") parts.push(`body_hash=${encodeURIComponent(bodyHash(body))}`);
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${encodeURIComponent(v)}`);
  return parts.join("&");
}

export function normalizedString(parts: {
  ts: number;
  nonce: string;
  method: string;
  requestUri: string;
  host: string;
  port?: number;
  ext: string;
}): string {
  return (
    [
      String(parts.ts),
      parts.nonce,
      parts.method.toUpperCase(),
      parts.requestUri,
      parts.host.toLowerCase(),
      String(parts.port ?? 443),
      parts.ext,
    ].join("\n") + "\n"
  );
}

export function computeMac(macKey: string, normalized: string): string {
  return createHmac("sha256", macKey).update(normalized, "utf8").digest("base64");
}

/** Nonce from the allowed ASCII ranges (%x20-21 / %x23-5B / %x5D-7E): we use alphanumerics. */
export function nonce(): string {
  return randomBytes(24)
    .toString("base64url")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 32);
}

export function authorizationHeader(
  creds: MacCredentials,
  method: string,
  url: URL,
  body: string | null,
  now: Date = new Date(),
  nonceValue: string = nonce(),
): string {
  const ts = Math.floor(now.getTime() / 1000);
  const ext = buildExt(body);
  const normalized = normalizedString({
    ts,
    nonce: nonceValue,
    method,
    requestUri: url.pathname + url.search,
    host: url.hostname,
    port: url.port ? Number(url.port) : 443,
    ext,
  });
  const mac = computeMac(creds.macKey, normalized);
  const fields = [`id="${creds.macId}"`, `ts="${ts}"`, `nonce="${nonceValue}"`, `mac="${mac}"`];
  if (ext) fields.push(`ext="${ext}"`);
  return `MAC ${fields.join(", ")}`;
}
