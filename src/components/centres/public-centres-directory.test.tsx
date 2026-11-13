import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicCentresDirectory } from "./public-centres-directory";

describe("public centre search control", () => {
  it("starts with an accessible loading state and no guessed location results", () => {
    const html = renderToStaticMarkup(createElement(PublicCentresDirectory, { serviceAreasOnly: true }));
    expect(html).toContain('aria-label="Published Rudra centres"');
    expect(html).toContain("Search service areas or centres");
    expect(html).toContain("Loading published centres");
    expect(html).not.toContain("Google Maps");
    expect(html).not.toContain("synthetic centre");
  });
});
