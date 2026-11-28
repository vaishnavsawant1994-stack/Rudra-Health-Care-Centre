import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeadDetail } from "./lead-workbench";
import { PublicEnquiryReview } from "./public-enquiry-workbench";

describe("public enquiry to CRM recovery controls", () => {
  it("renders a safe staff-review queue with refresh and live status", () => {
    const markup = renderToStaticMarkup(createElement(PublicEnquiryReview, {
      staffId: "synthetic-staff",
      canCreate: true,
      canAssign: false,
      canDismiss: false,
      taskGrants: [],
      relationshipGrants: [],
    }));

    expect(markup).toContain("Public enquiries awaiting review");
    expect(markup).toContain("These submissions are not patient records");
    expect(markup).toContain("Refresh</button>");
    expect(markup).toContain('aria-live="polite"');
  });

  it("keeps lead actions unavailable until current detail is loaded", () => {
    const markup = renderToStaticMarkup(createElement(LeadDetail, { leadId: "synthetic-lead" }));

    expect(markup).toContain("Retry loading lead");
    expect(markup).toContain('aria-live="polite"');
  });
});
