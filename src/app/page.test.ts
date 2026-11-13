import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RudraHomePage } from "@/components/public/rudra-reference-pages";

describe("public homepage catalogue and centre content", () => {
  it("does not show hard-coded demo services, prices, centres or unsupported partner claims", () => {
    const markup = renderToStaticMarkup(createElement(RudraHomePage));
    expect(markup).toContain("Current published services");
    expect(markup).toContain("Find a published Rudra centre");
    expect(markup).toContain('href="/track"');
    expect(markup).not.toContain("Full Body Checkup");
    expect(markup).not.toContain("Vijay Nagar");
    expect(markup).not.toContain("Approved Metropolis Partner");
  });
});
