import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/page-title", () => ({ PageTitle: ({ title }: { title: string }) => createElement("h1", null, title) }));
vi.mock("@/components/centres/public-centres-directory", () => ({ PublicCentresDirectory: () => createElement("div", { "data-testid": "published-centres" }, "Published centre directory") }));
vi.mock("@/components/leads/public-enquiry-workbench", () => ({ PublicEnquiryForm: () => createElement("div", { "data-testid": "enquiry-form" }, "Staff-reviewed enquiry") }));
vi.mock("@/components/website/public-content-override", () => ({ PublicContentSections: () => null }));
vi.mock("@/server/public-website-content", () => ({ getPublishedWebsiteMetadata: vi.fn() }));

import ContactPage from "./page";

describe("public contact page", () => {
  it("shows published centre contacts alongside the staff-reviewed enquiry form", () => {
    const html = renderToStaticMarkup(createElement(ContactPage));
    expect(html).toContain("Published centre contact details");
    expect(html).toContain("Published centre directory");
    expect(html).toContain("Staff-reviewed enquiry");
    expect(html.indexOf("Published centre directory")).toBeLessThan(html.indexOf("Staff-reviewed enquiry"));
    expect(html).toContain("patient account services are not activated");
  });
});
