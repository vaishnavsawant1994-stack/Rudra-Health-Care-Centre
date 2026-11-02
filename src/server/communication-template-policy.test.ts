import { describe, expect, it } from "vitest";
import { communicationTemplateContentSchema, communicationTemplateCreateSchema, communicationTemplatePatchSchema, renderCommunicationTemplate } from "./communication-template-policy";

describe("communication template policy", () => {
  it("accepts plain text and only the documented merge fields", () => {
    expect(communicationTemplateContentSchema.safeParse({ name: "Appointment reminder", body: "Hello {{firstName}}, reference {{leadNumber}}." }).success).toBe(true);
    expect(communicationTemplateCreateSchema.safeParse({ centreId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), purpose: "OPERATIONAL", channel: "EMAIL", name: "Reminder", body: "Visit {{centreName}} on {{appointmentDate}}." }).success).toBe(true);
  });

  it("rejects unsupported variables and malformed placeholders", () => {
    expect(communicationTemplateContentSchema.safeParse({ name: "Test", body: "{{medicalResult}}" }).success).toBe(false);
    expect(communicationTemplateContentSchema.safeParse({ name: "Test", body: "{{firstName" }).success).toBe(false);
  });

  it("renders only supplied values and fails closed for missing appointment data", () => {
    expect(renderCommunicationTemplate("Hello {{firstName}} · {{leadNumber}}", { firstName: "Synthetic", leadNumber: "RHC-L-1" })).toEqual({ ok: true, body: "Hello Synthetic · RHC-L-1" });
    expect(renderCommunicationTemplate("Visit {{appointmentDate}}", {})).toEqual({ ok: false, missing: ["appointmentDate"] });
  });

  it("requires a reason for activation and archive, and versioned changes for edits", () => {
    expect(communicationTemplatePatchSchema.safeParse({ action: "ACTIVATE", expectedVersion: 1 }).success).toBe(false);
    expect(communicationTemplatePatchSchema.safeParse({ action: "ACTIVATE", expectedVersion: 1, reason: "Approved internal copy" }).success).toBe(true);
    expect(communicationTemplatePatchSchema.safeParse({ action: "UPDATE", expectedVersion: 1 }).success).toBe(false);
  });
});
