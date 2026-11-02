import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("application API response cache policy", () => {
  it("marks every API route response private and non-cacheable", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toContainEqual({
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    });
  });
});
