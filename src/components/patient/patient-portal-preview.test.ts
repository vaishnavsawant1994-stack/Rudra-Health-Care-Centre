import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PatientPortalPreview, type PortalView } from "./patient-portal-preview";
import { PATIENT_PORTAL_GATE_NOTICE, PATIENT_PORTAL_SCREENS, PATIENT_PORTAL_SYNTHETIC_SCENARIOS } from "@/lib/patient-portal-preview-data";

const viewForScreen: Record<(typeof PATIENT_PORTAL_SCREENS)[number]["id"], PortalView> = {
  P001: "dashboard", P002: "profile", P003: "family", P004: "member", P005: "journey", P006: "appointments", P007: "appointment-change", P008: "orders",
  P009: "reports", P010: "billing", P011: "addresses", P012: "calendar", P013: "support", P014: "notifications", P015: "documents", P016: "trends",
};

describe("patient portal preview safety and screen coverage", () => {
  it("maps all 16 canonical screens to their original routes", () => {
    expect(PATIENT_PORTAL_SCREENS).toHaveLength(16);
    expect(new Set(PATIENT_PORTAL_SCREENS.map((screen) => screen.id)).size).toBe(16);
    expect(PATIENT_PORTAL_SCREENS.find((screen) => screen.id === "P005")?.route).toBe("/account/orders/synthetic-preview/journey");
    expect(PATIENT_PORTAL_SCREENS.find((screen) => screen.id === "P006")?.route).toBe("/account/appointments");
    expect(PATIENT_PORTAL_SCREENS.find((screen) => screen.id === "P007")?.route).toBe("/account/appointments/synthetic-preview/change");
    expect(PATIENT_PORTAL_SCREENS.find((screen) => screen.id === "P015")?.route).toBe("/account/health-documents");
    expect(PATIENT_PORTAL_SCREENS.find((screen) => screen.id === "P016")?.route).toBe("/account/health-trends");
  });

  it.each(PATIENT_PORTAL_SCREENS)("renders $id as gated and without patient data", ({ id }) => {
    const html = renderToStaticMarkup(createElement(PatientPortalPreview, { view: viewForScreen[id] }));
    expect(html).toContain(id);
    expect(html).toContain(PATIENT_PORTAL_GATE_NOTICE);
    expect(html).toContain("Show synthetic example");
    expect(html).toContain("Access disabled");
    expect(html).not.toMatch(/<form\b|<input\b|type="password"|patient-contact-secret/i);
    expect(html).not.toContain("Synthetic workflow example");
  });

  it("uses synthetic scenarios that avoid invented released results and completed lab events", () => {
    expect(Object.keys(PATIENT_PORTAL_SYNTHETIC_SCENARIOS)).toHaveLength(16);
    expect(PATIENT_PORTAL_SYNTHETIC_SCENARIOS.P005.join(" ")).toContain("Metropolis receipt: not recorded");
    expect(PATIENT_PORTAL_SYNTHETIC_SCENARIOS.P009.join(" ")).toContain("No medical report or clinical result");
    expect(PATIENT_PORTAL_SYNTHETIC_SCENARIOS.P016.join(" ")).toContain("No analyte");
    expect(Object.values(PATIENT_PORTAL_SYNTHETIC_SCENARIOS).flat().join(" ")).not.toMatch(/\b\d+(?:\.\d+)?\s*(?:mg\/dL|mmol\/L|g\/dL)\b/i);
  });
});
