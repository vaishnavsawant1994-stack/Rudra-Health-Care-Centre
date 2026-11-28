import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_CODE_PATTERN, CampaignWorkbench } from "./campaign-workbench";

describe("campaign attribution role view", () => {
  it("renders a read-only view without campaign management actions for marketing readers", () => {
    const html = renderToStaticMarkup(createElement(CampaignWorkbench, { managedCentreIds: [] }));

    expect(html).toContain("Read-only campaign attribution access.");
    expect(html).not.toContain("Create campaign record");
    expect(html).not.toContain("Save draft");
  });

  it("does not label marketing managers as read-only", () => {
    const html = renderToStaticMarkup(createElement(CampaignWorkbench, { managedCentreIds: ["*"] }));

    expect(html).not.toContain("Read-only campaign attribution access.");
  });

  it("preserves a modern-browser-safe hyphen escape in campaign code validation", () => {
    const pattern = new RegExp(`^(?:${CAMPAIGN_CODE_PATTERN})$`, "v");

    expect(pattern.test("SYN-ALPHA_2")).toBe(true);
    expect(pattern.test("-INVALID")).toBe(false);
  });
});
