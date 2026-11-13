import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicCookiePreferencesControl } from "./public-cookie-preferences";

describe("public cookie preference controls", () => {
  it("exposes keyboard-operable preference controls without enabling optional providers", () => {
    const html = renderToStaticMarkup(createElement(PublicCookiePreferencesControl));
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Cookie preferences</summary>");
    expect(html).toContain("Analytics preference (provider unavailable)");
    expect(html).toContain("Marketing preference (provider unavailable)");
    expect(html).toContain("does not enable tracking or activate an external service");
    expect(html).toContain("Save preferences on this device");
    expect(html).toContain("Use necessary only");
  });
});
