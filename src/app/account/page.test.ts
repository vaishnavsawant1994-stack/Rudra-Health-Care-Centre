import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountPage, { metadata } from "./page";

describe("patient account identity-proofing gate", () => {
  it("keeps patient registration and sign-in disabled until identity proofing is approved", () => {
    const html = renderToStaticMarkup(createElement(AccountPage));

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(html).toContain("Patient access unavailable");
    expect(html).toContain("Patient sign-in and protected patient data are disabled");
    expect(html).toContain("P001");
    expect(html).toContain("Show synthetic example");
    expect(html).not.toContain("name=");
    expect(html).not.toMatch(/<form\b|<input\b|type="password"|patient-contact-secret/i);
  });
});
