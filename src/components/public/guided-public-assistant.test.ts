import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuidedPublicAssistant, GuidedPublicHumanHandoff } from "./guided-public-assistant";

describe("guided public assistant", () => {
  it("starts with bounded service choices and no free-text chat box", () => {
    const markup = renderToStaticMarkup(createElement(GuidedPublicAssistant));
    expect(markup).toContain("This guided assistant uses fixed choices");
    expect(markup).toContain("Find a test or package");
    expect(markup).toContain("Request a visit");
    expect(markup).toContain("Contact the Rudra team");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("Create an account");
  });

  it("hands off to the existing consent-aware enquiry intake without saving a chat transcript", () => {
    const markup = renderToStaticMarkup(createElement(GuidedPublicHumanHandoff));
    expect(markup).toContain("Only information you submit is saved as an enquiry");
    expect(markup).toContain("marketing opt-in");
    expect(markup).toContain("Send an enquiry");
    expect(markup).toContain("Do not include medical results or urgent health information");
    expect(markup).not.toContain("transcript");
  });
});
