import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupportPortalPagesPreview } from "./support-portal-pages";
import { PatientPortalOperationsPreview } from "./patient-portal-operations";

describe("support, content and patient portal reference previews", () => {
  it("marks the sample screens synthetic and disables contact submission", () => {
    const html = renderToStaticMarkup(createElement(SupportPortalPagesPreview));
    expect(html).toContain("SYNTHETIC CONTENT ONLY");
    expect(html).toContain("No phone, WhatsApp, email or live-chat provider is configured");
    expect(html).toContain("Enquiry submission unavailable");
    expect(html).toContain("All patient names");
  });

  it("offers reference navigation without exposing a real patient account", () => {
    const html = renderToStaticMarkup(createElement(SupportPortalPagesPreview));
    expect(html).toContain("Portal dashboard");
    expect(html).toContain("Profile");
    expect(html).toContain("Family portal");
    expect(html).not.toContain("+91 98765");
    expect(html).not.toContain("Report ID:");
  });

  it("labels portal journey and order examples synthetic and blocks live actions", () => {
    const html = renderToStaticMarkup(createElement(PatientPortalOperationsPreview));
    expect(html).toContain("SYNTHETIC PORTAL");
    expect(html).toContain("RDR-DEMO-250428-0123");
    expect(html).toContain("External receipt and processing are not asserted");
    expect(html).toContain("Report download disabled");
    expect(html).toContain("No portal session, real patient record");
  });

});
