import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountPage, { metadata } from "./page";

describe("patient account identity-proofing gate", () => {
  it("keeps patient registration and sign-in disabled until identity proofing is approved", () => {
    const html = renderToStaticMarkup(createElement(AccountPage));

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(html).toContain("Patient accounts are disabled");
    expect(html).toContain("no patient sign-in, registration, demo account or patient information");
    expect(html).toContain("A family relationship alone will never provide access");
    expect(html).not.toMatch(/<form\b|<input\b|type="password"/i);
  });
});
