import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TestDetailsPage from "./page";

describe("published test detail route", () => {
  it("never substitutes a demo test when a public catalogue item is unavailable", async () => {
    const page = await TestDetailsPage({ params: Promise.resolve({ id: "cbc" }) });
    const markup = renderToStaticMarkup(page);
    expect(markup).toContain("Loading verified service details");
    expect(markup).not.toContain("Complete Blood Count (CBC)");
    expect(markup).not.toContain("₹ 450");
  });
});
