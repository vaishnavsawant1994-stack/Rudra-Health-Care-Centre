import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppointmentCalendar, AppointmentDashboard } from "./appointment-workbench";

describe("appointment overview recovery controls", () => {
  it("renders a refresh action and a live loading status", () => {
    const markup = renderToStaticMarkup(createElement(AppointmentDashboard));
    expect(markup).toContain("Refresh overview");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Loading authorized centres");
  });

  it("renders a retry action and live status on the canonical appointment calendar", () => {
    const markup = renderToStaticMarkup(createElement(AppointmentCalendar));
    expect(markup).toContain("Refresh calendar");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Loading appointments");
  });
});
