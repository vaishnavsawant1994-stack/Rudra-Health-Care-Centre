import { describe, expect, it } from "vitest";
import { appointmentCreateSchema, appointmentUpdateSchema, canTransitionAppointment, homeCharge, localDateTimeToUtc, visibleAppointmentCentres, appointmentPermission } from "./appointment-policy";

const centre = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";
const valid = { centreId: centre, patientId: "0b191525-1f83-4490-9f46-578a217cafb0", visitType: "CENTRE", scheduledLocal: "2099-01-05T09:30", services: [{ type: "OTHER", name: "Synthetic service reference" }] };

describe("appointment booking policy", () => {
  it("validates centre bookings and prevents invalid home-charge data", () => {
    expect(appointmentCreateSchema.safeParse(valid).success).toBe(true);
    expect(appointmentCreateSchema.safeParse({ ...valid, scheduledLocal: "2026-10-30T11:00", services: [{ type: "OTHER", name: "DEMO-TEST-SERVICE" }] }).success).toBe(true);
    expect(appointmentCreateSchema.safeParse({ ...valid, visitType: "HOME_COLLECTION" }).success).toBe(false);
    const home = { visitType: "HOME_COLLECTION", address: { line1: "12 Synthetic Road", city: "Test City", state: "Test State", postalCode: "123456" }, preferredWindow: "9–11 AM", chargeChoice: "CUSTOM", customAmountRupees: 125, chargeReason: "Approved local fee" };
    expect(appointmentCreateSchema.safeParse({ ...valid, visitType: "HOME_COLLECTION", homeCollection: home }).success).toBe(true);
    expect(appointmentCreateSchema.safeParse({ ...valid, visitType: "HOME_COLLECTION", homeCollection: { ...home, chargeReason: undefined } }).success).toBe(false);
    expect(homeCharge("ZERO")).toBe(0);
    expect(homeCharge("75")).toBe(75);
    expect(homeCharge("CUSTOM", 125)).toBe(125);
  });

  it("requires reasons for schedule, assignment and status changes", () => {
    const version = "2099-01-01T00:00:00.000Z";
    expect(appointmentUpdateSchema.safeParse({ expectedUpdatedAt: version, scheduledLocal: "2099-01-05T09:30" }).success).toBe(false);
    expect(appointmentUpdateSchema.safeParse({ expectedUpdatedAt: version, scheduledLocal: "2099-01-05T09:30", reason: "Patient requested change" }).success).toBe(true);
    expect(appointmentUpdateSchema.safeParse({ expectedUpdatedAt: version, status: "CANCELLED", reason: "Patient cancelled" }).success).toBe(true);
    expect(appointmentUpdateSchema.safeParse({ expectedUpdatedAt: version, communicationPermission: "AUTHORIZED" }).success).toBe(false);
    expect(appointmentUpdateSchema.safeParse({ expectedUpdatedAt: version }).success).toBe(false);
  });

  it("rejects invalid timezone dates and converts local centre time to UTC", () => {
    expect(localDateTimeToUtc("2099-02-30T09:30", "Asia/Kolkata")).toBeNull();
    expect(localDateTimeToUtc("2099-01-05T09:30", "Bad/Zone")).toBeNull();
    expect(localDateTimeToUtc("2099-01-05T09:30", "Asia/Kolkata")?.toISOString()).toBe("2099-01-05T04:00:00.000Z");
  });

  it("enforces appointment lifecycle and centre-scoped staff grants", () => {
    expect(canTransitionAppointment("REQUESTED", "CONFIRMED")).toBe(true);
    expect(canTransitionAppointment("CANCELLED", "CONFIRMED")).toBe(false);
    const grants = [{ key: "appointments.read", centreId: centre }, { key: "appointments.create", centreId: null }];
    expect(appointmentPermission(grants, "appointments.read", centre)).toBe(true);
    expect(appointmentPermission(grants, "appointments.read", "other-centre")).toBe(false);
    expect(visibleAppointmentCentres(grants, "appointments.read")).toEqual([centre]);
    expect(visibleAppointmentCentres(grants, "appointments.create")).toBeNull();
  });
});
