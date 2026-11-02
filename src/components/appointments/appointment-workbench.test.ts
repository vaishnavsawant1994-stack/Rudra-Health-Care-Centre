import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppointmentCreateForm } from "./appointment-workbench";

describe("CRM-linked appointment form", () => {
  it("fails closed while conversion is unverified and does not offer patient substitution", () => {
    const markup = renderToStaticMarkup(createElement(AppointmentCreateForm, {
      leadId: "synthetic-lead-id",
      initialCentreId: "synthetic-centre-id",
    }));

    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("Loading authorized centres");
    expect(markup).toContain("Create booking request");
    expect(markup).not.toContain("Search by patient name");
    expect(markup).not.toContain("Search patients</button>");
  });

  it("keeps normal patient lookup available for a staff-created booking", () => {
    const markup = renderToStaticMarkup(createElement(AppointmentCreateForm));

    expect(markup).toContain("Search by patient name, ID or phone");
    expect(markup).toContain("Search patients</button>");
  });
});
