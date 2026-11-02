import { z } from "zod";

const timeZone = z.string().trim().min(1).max(64).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Use a valid IANA timezone.");
export const staffShiftSchema = z.object({
  centreId: z.uuid(), staffId: z.uuid(), shiftType: z.enum(["SCHEDULED", "UNAVAILABLE"]),
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), timeZone, note: z.string().trim().max(500).default(""),
}).superRefine((value, ctx) => {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Shift end must be after its start." });
});

export type RosterShiftBlock = { staffId: string; shiftType: "SCHEDULED" | "UNAVAILABLE"; startsAt: Date; endsAt: Date };
export type AssignedWorkBlock = { staffId: string; startsAt: Date; endsAt: Date };

export function rosterConflictEscalationSourceType(kind: "APPOINTMENT" | "COLLECTION") {
  return kind === "COLLECTION" ? "COLLECTION_JOB" as const : "APPOINTMENT" as const;
}

/** Shared PostgreSQL advisory-lock namespace for appointment and collection assignment mutations. */
export function staffAssignmentLockKey(organizationId: string, staffId: string) {
  return `${organizationId}:collection-staff:${staffId}`;
}

export function rosterAssignmentConflictFlags<T extends AssignedWorkBlock>(work: readonly T[], shifts: readonly RosterShiftBlock[]) {
  const flags = work.map(() => new Set<string>());
  const byStaff = new Map<string, RosterShiftBlock[]>();
  for (const shift of shifts) byStaff.set(shift.staffId, [...(byStaff.get(shift.staffId) ?? []), shift]);
  work.forEach((item, index) => {
    const staffShifts = byStaff.get(item.staffId) ?? [];
    if (!staffShifts.some((shift) => shift.shiftType === "SCHEDULED" && shift.startsAt <= item.startsAt && shift.endsAt >= item.endsAt)) flags[index].add("OUTSIDE_SCHEDULED_SHIFT");
    if (staffShifts.some((shift) => shift.shiftType === "UNAVAILABLE" && shift.startsAt < item.endsAt && shift.endsAt > item.startsAt)) flags[index].add("DURING_UNAVAILABILITY");
  });
  for (let i = 0; i < work.length; i += 1) for (let j = i + 1; j < work.length; j += 1) {
    if (work[i].staffId === work[j].staffId && work[i].startsAt < work[j].endsAt && work[i].endsAt > work[j].startsAt) {
      flags[i].add("OVERLAPPING_ASSIGNMENT"); flags[j].add("OVERLAPPING_ASSIGNMENT");
    }
  }
  return work.flatMap((item, index) => flags[index].size ? [{ ...item, advisoryFlags: [...flags[index]] }] : []).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export const staffShiftPatchSchema = z.object({ expectedVersion: z.number().int().positive(), action: z.enum(["UPDATE", "CANCEL"]), startsAt: z.iso.datetime().optional(), endsAt: z.iso.datetime().optional(), timeZone: timeZone.optional(), note: z.string().trim().max(500).optional(), reason: z.string().trim().min(3).max(240).optional() }).superRefine((value, ctx) => {
  if (value.action === "CANCEL" && !value.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A cancellation reason is required." });
  if (value.action === "UPDATE" && ![value.startsAt, value.endsAt, value.timeZone, value.note].some((item) => item !== undefined)) ctx.addIssue({ code: "custom", message: "Provide a shift update." });
});
