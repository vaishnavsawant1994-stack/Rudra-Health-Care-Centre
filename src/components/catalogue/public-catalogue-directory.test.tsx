import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicCatalogueDirectory } from "./public-catalogue-directory";

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
