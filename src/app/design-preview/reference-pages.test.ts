import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReferencePagesPreview } from "./reference-pages";

describe("public reference page design preview", () => {
  it("labels examples synthetic and keeps patient identity actions unavailable", () => {
    const html = renderToStaticMarkup(createElement(ReferencePagesPreview));
    expect(html).toContain("SYNTHETIC EXAMPLES ONLY");
    expect(html).toContain("This preview does not query Rudra data");
    expect(html).toContain("No sample events are created");
    expect(html).toContain("All sample entries are fictional");
  });

  it("does not expose patient account or report information in the initial screen", () => {
    const html = renderToStaticMarkup(createElement(ReferencePagesPreview));
    expect(html).toContain("Home collection");
    expect(html).toContain("No amount is quoted or saved");
    expect(html).not.toContain("Verified Patient");
    expect(html).not.toContain("Report Ready");
  });
});
