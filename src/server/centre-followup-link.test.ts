import { describe, expect, it } from "vitest";
import { centreFollowupHref } from "./centre-followup-link";

describe("centreFollowupHref", () => {
  it("links lead follow-up queue items to their exact record and centre", () => {
    const href = centreFollowupHref("LEAD_FOLLOWUP", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
    const url = new URL(href, "http://rudra.local");
    expect(url.pathname).toBe("/leads/followups");
    expect(url.searchParams.get("followupId")).toBe("11111111-1111-4111-8111-111111111111");
    expect(url.searchParams.get("centreId")).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("links report follow-up queue items to their exact record and centre", () => {
    const href = centreFollowupHref("REPORT_FOLLOWUP", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444");
    const url = new URL(href, "http://rudra.local");
    expect(url.pathname).toBe("/reports/followups");
    expect(url.searchParams.get("followupId")).toBe("33333333-3333-4333-8333-333333333333");
    expect(url.searchParams.get("centreId")).toBe("44444444-4444-4444-8444-444444444444");
  });
});
