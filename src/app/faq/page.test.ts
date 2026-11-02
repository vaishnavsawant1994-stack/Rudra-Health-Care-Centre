import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FaqContent } from "./page";

describe("public FAQ guidance handoff", () => {
  it("links to the fixed-choice service guide without presenting it as AI or medical advice", () => {
    const markup = renderToStaticMarkup(createElement(FaqContent, { items: [] }));

    expect(markup).toContain('href="/chat"');
    expect(markup).toContain("Open Rudra service guide");
    expect(markup).toContain("not an AI or medical-advice service");
    expect(markup).toContain("Frequently asked questions");
  });
});
