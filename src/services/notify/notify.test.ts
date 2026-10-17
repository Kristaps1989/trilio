import { describe, expect, it } from "vitest";
import { createEmailSender, escapeHtml, memoryEmailSender } from "./email";
import { createPushSender, memoryPushSender, pushPublicKey } from "./push";

describe("email sender", () => {
  it("is disabled without an API key and records in memory for tests", async () => {
    const off = createEmailSender({});
    expect(await off.send({ to: "a@b.lv", subject: "s", text: "t" })).toEqual({
      ok: false,
      reason: "disabled",
    });
    const mem = memoryEmailSender();
    expect(await mem.send({ to: "a@b.lv", subject: "s", text: "t" })).toEqual({ ok: true, id: "mem-1" });
    expect(mem.sent).toHaveLength(1);
  });
  it("escapes HTML in the fallback body", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
  });
});

describe("push sender", () => {
  it("is disabled without VAPID keys", async () => {
    expect(pushPublicKey({})).toBeNull();
    expect(pushPublicKey({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "k" })).toBe("k");
    const off = createPushSender({});
    expect(
      await off.send({ endpoint: "https://x", p256dh: "p", auth: "a" }, { title: "t", body: "b", url: "/" }),
    ).toEqual({ ok: false, reason: "disabled" });
    const mem = memoryPushSender();
    expect(
      await mem.send({ endpoint: "https://x", p256dh: "p", auth: "a" }, { title: "t", body: "b", url: "/" }),
    ).toEqual({ ok: true });
    expect(mem.sent).toHaveLength(1);
  });
});
