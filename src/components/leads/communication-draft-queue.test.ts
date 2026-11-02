import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnifiedCommunicationInbox } from "./communication-draft-queue";

describe("unified communications inbox", () => {
  it("provides separate enquiry and unsent-draft views without exposing private message data", () => {
    const markup = renderToStaticMarkup(createElement(UnifiedCommunicationInbox));
    expect(markup).toContain("Website enquiries");
    expect(markup).toContain("Unsent drafts");
    expect(markup).toContain("Enquiry rows show reference metadata only");
    expect(markup).toContain("No external email, SMS, WhatsApp or voice provider is connected");
    expect(markup).not.toContain("patient phone");
    expect(markup).not.toContain("Delivery: sent");
    expect(markup).not.toContain("CRM follow-ups");
  });

  it("shows the CRM follow-up view only when the parent grants the combined capability", () => {
    const InboxWithFollowups = UnifiedCommunicationInbox as (props: { canReadFollowups?: boolean }) => ReturnType<typeof UnifiedCommunicationInbox>;
    const markup = renderToStaticMarkup(createElement(InboxWithFollowups, { canReadFollowups: true }));
    expect(markup).toContain("CRM follow-ups");
    expect(markup).toContain("does not send or schedule messages");
  });
});
