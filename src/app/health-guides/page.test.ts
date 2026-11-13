import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HealthGuidesPage from "./page";
import { metadata } from "./page";

describe("public health guides route", () => {
  it("uses general educational content with clinical boundaries", () => {
    const markup = renderToStaticMarkup(createElement(HealthGuidesPage));
    expect(markup).toContain("Clear information for a healthier tomorrow");
    expect(markup).toContain("does not diagnose");
    expect(markup).toContain("/health-info/preventive-checkups");
    expect(markup).toContain("Clinical review pending");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
