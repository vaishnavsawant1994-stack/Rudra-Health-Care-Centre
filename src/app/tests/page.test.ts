import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TestsPage from "./page";

describe("public diagnostic test directory", () => {
  it("renders the live published catalogue directory instead of illustrative price fixtures", () => {
    const markup = renderToStaticMarkup(createElement(TestsPage));
    expect(markup).toContain("Diagnostic Tests");
    expect(markup).toContain("Loading currently published services");
    expect(markup).not.toContain("Complete Blood Count (CBC)");
    expect(markup).not.toContain("â‚¹ 450");
  });
});
