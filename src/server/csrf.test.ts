import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./csrf";
describe("same-origin write protection", () => {
  it("accepts same-origin form actions only", () => {
    expect(isSameOriginRequest(new Request("https://rudra.test/api/admin", { headers: { origin: "https://rudra.test", "sec-fetch-site": "same-origin" } }))).toBe(true);
    expect(isSameOriginRequest(new Request("https://rudra.test/api/admin", { headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" } }))).toBe(false);
    expect(isSameOriginRequest(new Request("https://rudra.test/api/admin"))).toBe(false);
  });
});
