import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: string }) => createElement("a", { href }, children) }));
vi.mock("@/components/ui/page-title", () => ({ PageTitle: ({ title }: { title: string }) => createElement("h1", null, title) }));
vi.mock("@/components/ui/action-button", () => ({ ActionButton: ({ href, children }: { href: string; children: string }) => createElement("a", { href }, children) }));
vi.mock("@/components/leads/public-enquiry-workbench", () => ({ PublicEnquiryForm: ({ topic }: { topic: string }) => createElement("div", { "data-topic": topic }, "Encrypted staff-reviewed enquiry") }));
vi.mock("@/components/website/public-content-override", () => ({ PublicContentSections: () => null }));

import { BusinessServicesPage } from "./business-services-page";

describe("public doctor, corporate and partner service pages", () => {
  it.each([
    ["corporate", "CORPORATE"],
    ["doctors", "DOCTOR"],
    ["partners", "PARTNER"],
  ] as const)("connects %s visitors to verified catalogues and its staff-reviewed enquiry", (kind, topic) => {
    const html = renderToStaticMarkup(createElement(BusinessServicesPage, { kind }));
    expect(html).toContain("Browse published diagnostic services");
    expect(html).toContain('href="/tests"');
    expect(html).toContain('href="/packages"');
    expect(html).toContain('href="/centres"');
    expect(html).toContain(`data-topic="${topic}"`);
    expect(html).toContain("does not enroll you in marketing or confirm any service");
    expect(html).toContain("Do not submit patient identifiers");
    expect(html).toContain("Rudra staff review each enquiry");
    expect(html).toContain("that request before contacting you");
    expect(html).not.toContain("Illustrative interface preview");
    expect(html).not.toContain("Enquiry status Not connected");
  });
});
