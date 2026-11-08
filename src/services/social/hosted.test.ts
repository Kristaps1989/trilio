import { describe, expect, it } from "vitest";
import { hostedPicture } from "./share";

describe("a card's picture on Facebook's servers", () => {
  it("takes an https address on fbcdn.net only", () => {
    const fb = "https://scontent.frix2-1.fna.fbcdn.net/v/t39/123_n.jpg?oh=a&oe=b";
    expect(hostedPicture(fb)).toBe(fb);
    expect(hostedPicture("https://fbcdn.net/x.jpg")).toBe("https://fbcdn.net/x.jpg");
    expect(hostedPicture("http://scontent.fbcdn.net/x.jpg")).toBeNull();
    expect(hostedPicture("https://evil.example/fbcdn.net.jpg")).toBeNull();
    expect(hostedPicture("https://fbcdn.net.evil.example/x.jpg")).toBeNull();
    expect(hostedPicture("javascript:alert(1)")).toBeNull();
    expect(hostedPicture(null)).toBeNull();
    expect(hostedPicture("")).toBeNull();
  });
});
