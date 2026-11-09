import { describe, expect, it } from "vitest";
import { composeSignInEmail } from "./signin-email";

describe("the sign-in e-mail", () => {
  const url = "https://trilio.lv/api/auth/callback/resend?token=abc&email=anna%40example.lv";
  it("is Trilio's own, in Latvian by default, with the link and how long it works", () => {
    const m = composeSignInEmail({
      to: "anna@example.lv",
      url,
      lang: "lv",
      baseUrl: "https://trilio.lv",
      company: "SIA Trilio",
    });
    expect(m.subject).toBe("Ienākt Trilio");
    expect(m.text).toContain(url);
    expect(m.text).toContain("15 minūtes");
    expect(m.html).toContain("https://trilio.lv/email/logo.png");
    expect(m.html).toContain(url.replace(/&/g, "&amp;"));
    expect(m.html).toContain("SIA Trilio");
  });
  it("in English for an /en visitor", () => {
    const m = composeSignInEmail({ to: "a@example.com", url, lang: "en", baseUrl: "https://trilio.lv" });
    expect(m.subject).toBe("Sign in to Trilio");
    expect(m.text).toContain("15 minutes");
  });
});
