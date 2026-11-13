import { describe, expect, it } from "vitest";
import { canAccessFamilyCentre, familyCreateSchema, familyGrantAllows, familyGrantCreateSchema, familyMemberCreateSchema, visibleFamilyCentres } from "./family-policy";

describe("family relationship and explicit sharing policy", () => {
  const future = new Date("2026-11-01T00:00:00.000Z");
  const activeGrant = {
    patientId: "patient-a", granteePatientId: "patient-b", allowedData: ["APPOINTMENTS"], status: "ACTIVE",
    authorizationBasis: "PATIENT_SELF", evidenceReference: "offline-case-ref-42", verifiedAt: new Date("2026-10-28T00:00:00.000Z"),
    effectiveAt: new Date("2026-10-28T00:00:00.000Z"), expiresAt: null, revokedAt: null,
  };

  it("does not allow a family relationship by itself to grant patient data access", () => {
    expect(familyGrantAllows(null, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "REPORTS", at: future })).toBe(false);
    expect(familyGrantAllows({ ...activeGrant, status: "PENDING_VERIFICATION" }, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "APPOINTMENTS", at: future })).toBe(false);
  });

  it("requires verified evidence, matching named people, allowed data and an effective window", () => {
    expect(familyGrantAllows(activeGrant, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "APPOINTMENTS", at: future })).toBe(true);
    expect(familyGrantAllows(activeGrant, { patientId: "patient-other", granteePatientId: "patient-b", dataType: "APPOINTMENTS", at: future })).toBe(false);
    expect(familyGrantAllows(activeGrant, { patientId: "patient-a", granteePatientId: "patient-other", dataType: "APPOINTMENTS", at: future })).toBe(false);
    expect(familyGrantAllows(activeGrant, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "REPORTS", at: future })).toBe(false);
    expect(familyGrantAllows({ ...activeGrant, evidenceReference: null }, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "APPOINTMENTS", at: future })).toBe(false);
    expect(familyGrantAllows({ ...activeGrant, expiresAt: new Date("2026-10-30T00:00:00.000Z") }, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "APPOINTMENTS", at: future })).toBe(false);
    expect(familyGrantAllows({ ...activeGrant, effectiveAt: new Date("2026-11-02T00:00:00.000Z") }, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "APPOINTMENTS", at: future })).toBe(false);
    expect(familyGrantAllows({ ...activeGrant, revokedAt: new Date("2026-10-29T00:00:00.000Z") }, { patientId: "patient-a", granteePatientId: "patient-b", dataType: "APPOINTMENTS", at: future })).toBe(false);
  });

  it("validates family creation and requires one member source", () => {
    expect(familyCreateSchema.safeParse({ centreId: "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34", displayName: "Synthetic family" }).success).toBe(true);
    expect(familyMemberCreateSchema.safeParse({ relationship: "OTHER" }).success).toBe(false);
    expect(familyMemberCreateSchema.safeParse({ patientId: "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34", newPatient: {}, relationship: "OTHER" }).success).toBe(false);
    expect(familyGrantCreateSchema.safeParse({ patientId: "p", granteePatientId: "p", allowedData: ["REPORTS"], purpose: "Care coordination", authorizationBasis: "PATIENT_SELF" }).success).toBe(false);
  });

  it("enforces centre-scoped family permissions", () => {
    const grants = [{ key: "families.read", centreId: "centre-a" }, { key: "families.create", centreId: null }];
    expect(canAccessFamilyCentre(grants, "families.read", "centre-a")).toBe(true);
    expect(canAccessFamilyCentre(grants, "families.read", "centre-b")).toBe(false);
    expect(visibleFamilyCentres(grants, "families.read")).toEqual(["centre-a"]);
    expect(visibleFamilyCentres(grants, "families.create")).toBeNull();
  });
});
