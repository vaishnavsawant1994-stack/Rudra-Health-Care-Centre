import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PackageDetailsPage from "./page";

describe("published package detail route", () => {
  it("never substitutes a demo package when a public catalogue item is unavailable", async () => {
    const page = await PackageDetailsPage({ params: Promise.resolve({ id: "full-body" }) });
    const markup = renderToStaticMarkup(page);
    expect(markup).toContain("Loading verified service details");
    expect(markup).not.toContain("Full Body Checkup");
    expect(markup).not.toContain("₹ 1,999");
  });
});
