import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalPolicyPage } from "./rudra-content-pages";

describe("public legal draft content", () => {
  it("makes the pending legal approval and non-binding draft state explicit", () => {
    const markup = renderToStaticMarkup(createElement(LegalPolicyPage, { slug: "privacy" }));
    expect(markup).toContain("Privacy notice");
    expect(markup).toContain("approval pending");
    expect(markup).toContain("not a final legal notice or binding policy");
    expect(markup).toContain('href="/contact"');
  });
});
