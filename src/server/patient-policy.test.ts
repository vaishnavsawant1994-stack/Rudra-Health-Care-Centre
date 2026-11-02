import { describe, expect, it } from "vitest";
import { canAccessPatientCentre, normalizePatientSearch, patientCreateSchema, patientUpdateSchema, visiblePatientCentres } from "./patient-policy";

describe("patient registration validation and centre access", () => {
  const valid = {
    centreId: "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34",
    firstName: "Synthetic", lastName: "Patient", dateOfBirth: "1990-02-03",
    phone: "+91 98765 43210", email: "PATIENT@example.test", consentStatus: "GRANTED", consentMethod: "IN_PERSON",
  };

  it("normalizes contacts and validates bounded patient input", () => {
    const parsed = patientCreateSchema.parse(valid);
    expect(parsed.phone).toBe("+919876543210");
    expect(parsed.email).toBe("PATIENT@example.test");
    expect(patientCreateSchema.safeParse({ ...valid, dateOfBirth: "2999-01-01" }).success).toBe(false);
    const defaultConsent = patientCreateSchema.parse({ ...valid, consentStatus: undefined, consentMethod: undefined });
    expect(defaultConsent.consentStatus).toBe("NOT_RECORDED");
    expect(defaultConsent.consentMethod).toBeUndefined();
    expect(patientCreateSchema.safeParse({ ...valid, consentStatus: "NOT_RECORDED", consentMethod: "IN_PERSON" }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...valid, consentStatus: "GRANTED", consentMethod: undefined }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...valid, consentStatus: "NOT_RECORDED", consentMethod: "" }).success).toBe(true);
  });

  it("requires consent method when a consent status is changed", () => {
    expect(patientUpdateSchema.safeParse({ consentStatus: "WITHDRAWN" }).success).toBe(false);
    expect(patientUpdateSchema.safeParse({ consentStatus: "WITHDRAWN", consentMethod: "PHONE" }).success).toBe(true);
    expect(patientUpdateSchema.safeParse({ consentStatus: "NOT_RECORDED" }).success).toBe(true);
    expect(patientUpdateSchema.safeParse({ consentStatus: "NOT_RECORDED", consentMethod: "" }).success).toBe(true);
    expect(patientUpdateSchema.safeParse({ consentMethod: "PHONE" }).success).toBe(false);
    expect(patientUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("enforces exact centre and organization-wide grants", () => {
    const grants = [{ key: "patients.read", centreId: "centre-a" }, { key: "patients.create", centreId: null }];
    expect(canAccessPatientCentre(grants, "patients.read", "centre-a")).toBe(true);
    expect(canAccessPatientCentre(grants, "patients.read", "centre-b")).toBe(false);
    expect(visiblePatientCentres(grants, "patients.read")).toEqual(["centre-a"]);
    expect(visiblePatientCentres(grants, "patients.create")).toBeNull();
  });

  it("escapes wildcard search syntax", () => {
    expect(normalizePatientSearch(" 100%_\"\\ ")).toBe("100\\%\\_\"\\\\");
  });
});
