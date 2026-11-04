import { describe, expect, it } from "vitest";
import { escalationDeepLinkHref, escalationDeepLinkId } from "./escalation-deep-link";

describe("escalation deep links", () => {
  it("builds an item-specific queue link", () => {
    expect(escalationDeepLinkHref("550e8400-e29b-41d4-a716-446655440000")).toBe("/escalations?escalationId=550e8400-e29b-41d4-a716-446655440000");
    expect(escalationDeepLinkHref("550e8400-e29b-41d4-a716-446655440000", "centre-id")).toBe("/escalations?escalationId=550e8400-e29b-41d4-a716-446655440000&centreId=centre-id");
  });

  it("accepts only a valid UUID query value", () => {
    expect(escalationDeepLinkId("?escalationId=550e8400-e29b-41d4-a716-446655440000")).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(escalationDeepLinkId("?escalationId=invalid")).toBeNull();
    expect(escalationDeepLinkId("?other=550e8400-e29b-41d4-a716-446655440000")).toBeNull();
  });
});
