import { describe, expect, it } from "vitest";
import { canShowSupportQueueLink, getAccessFallbackPermissions, resolveAdminAccess } from "./admin-shell";

describe("admin shell access fallbacks", () => {
  it("allows support-only readers to reach the support ticket page after broad and assigned checks deny", () => {
    expect(getAccessFallbackPermissions("tasks.read")).toEqual(["tasks.assigned.read", "tasks.support.read"]);
  });

  it("preserves the existing scoped fallbacks for appointments and field collection", () => {
    expect(getAccessFallbackPermissions("appointments.read")).toEqual(["appointments.assigned.read"]);
    expect(getAccessFallbackPermissions("collections.read")).toEqual(["collections.visit.record"]);
  });

  it("does not invent fallback grants for unrelated permissions", () => {
    expect(getAccessFallbackPermissions("patients.read")).toEqual([]);
  });

  it("shows the support queue link only to broad, assigned-only, or support readers", () => {
    expect(canShowSupportQueueLink([{ key: "tasks.read" }])).toBe(true);
    expect(canShowSupportQueueLink([{ key: "tasks.assigned.read" }])).toBe(true);
    expect(canShowSupportQueueLink([{ key: "tasks.support.read" }])).toBe(true);
    expect(canShowSupportQueueLink([{ key: "tasks.support.create" }])).toBe(false);
    expect(canShowSupportQueueLink([{ key: "patients.read" }])).toBe(false);
  });

  it("tries the support scope only after broad and assigned-task access are denied", async () => {
    const allowed = { kind: "allowed" as const, staff: {} as never };
    const lookup = async (permission: string) => permission === "tasks.support.read" ? allowed : { kind: "denied" as const };

    await expect(resolveAdminAccess("tasks.read", lookup)).resolves.toBe(allowed);
  });

  it("does not fall through MFA or unavailable states into another permission check", async () => {
    const mfaRequired = { kind: "mfa-setup-required" as const };
    const lookup = async (permission: string) => permission === "tasks.read" ? mfaRequired : { kind: "allowed" as const, staff: {} as never };

    await expect(resolveAdminAccess("tasks.read", lookup)).resolves.toBe(mfaRequired);
  });
});
