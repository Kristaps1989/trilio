import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizationHeader, bodyHash, buildExt, computeMac, nonce, normalizedString } from "./mac";

describe("Paysera MAC", () => {
  it("builds the normalized string exactly like the documented GET example", () => {
    const s = normalizedString({
      ts: 1343811600,
      nonce: "nQnNaSNyubfPErjRO55yaaEYo9YZfKHN",
      method: "get",
      requestUri: "/rest/v1/payment/10145",
      host: "Wallet.Paysera.com",
      ext: "",
    });
    expect(s).toBe(
      "1343811600\nnQnNaSNyubfPErjRO55yaaEYo9YZfKHN\nGET\n/rest/v1/payment/10145\nwallet.paysera.com\n443\n\n",
    );
  });

  it("hashes the body with sha256/base64 and URL-encodes the padding in ext", () => {
    const body = '{"beneficiary": "EVP1234567890", "amount": 1000}';
    const expected = createHash("sha256").update(body).digest("base64");
    expect(expected.endsWith("=")).toBe(true);
    expect(bodyHash(body)).toBe(expected);
    expect(buildExt(body)).toBe(`body_hash=${expected.replace(/=/g, "%3D")}`);
    expect(buildExt(null)).toBe("");
    expect(buildExt(body, { project_id: "1221" })).toBe(
      `body_hash=${expected.replace(/=/g, "%3D")}&project_id=1221`,
    );
  });

  it("produces a deterministic header for given ts and nonce", () => {
    const creds = { macId: "wkVd93h2uS", macKey: "secret" };
    const url = new URL("https://checkout-eu-a.paysera.com/checkout/rest/v1/payment-requests");
    const body = '{"a":1}';
    const h = authorizationHeader(creds, "POST", url, body, new Date(1343811600 * 1000), "n0nce");
    const expectedMac = computeMac(
      "secret",
      "1343811600\nn0nce\nPOST\n/checkout/rest/v1/payment-requests\ncheckout-eu-a.paysera.com\n443\n" +
        buildExt(body) +
        "\n",
    );
    expect(h).toBe(
      `MAC id="wkVd93h2uS", ts="1343811600", nonce="n0nce", mac="${expectedMac}", ext="${buildExt(body)}"`,
    );
    const get = authorizationHeader(creds, "GET", url, null, new Date(1343811600 * 1000), "n0nce");
    expect(get).not.toContain("ext=");
  });

  it("nonce uses only allowed characters", () => {
    for (let i = 0; i < 20; i++) expect(nonce()).toMatch(/^[A-Za-z0-9]{16,32}$/);
  });
});
