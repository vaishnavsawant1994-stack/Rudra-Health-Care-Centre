import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicCatalogueDirectory } from "./public-catalogue-directory";
import { PublicFeaturedServices } from "./public-featured-services";

describe("public catalogue directory heading semantics", () => {
  it("uses a page heading on the catalogue route by default", () => {
    const markup = renderToStaticMarkup(createElement(PublicCatalogueDirectory, { serviceType: "TEST" }));
    expect(markup).toContain("<h1>Diagnostic Tests</h1>");
  });

  it("can render a section heading when embedded in the offers page", () => {
    const markup = renderToStaticMarkup(createElement(PublicCatalogueDirectory, { serviceType: "PACKAGE", headingLevel: "h2" }));
    expect(markup).toContain("<h2>Health Checkup Packages</h2>");
    expect(markup).not.toContain("<h1>");
  });
});

describe("public featured catalogue accessibility", () => {
  it("announces loading status without making the entire service list a live region", () => {
    const markup = renderToStaticMarkup(createElement(PublicFeaturedServices));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('aria-live=');
  });
});
