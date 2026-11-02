import { describe, expect, it } from "vitest";
import { handoverActionFingerprint, handoverCreateFingerprint, sameHandoverActionReason, sameHandoverPrivateNote, sameShiftPrivateNote, shiftCreateFingerprint } from "@/server/staff-roster-idempotency";

describe("staff roster private-data idempotency", () => {
  it("keeps shift and handover notes out of hashes and compares them separately", () => {
    const shift = { centreId: "centre", staffId: "staff", shiftType: "SCHEDULED", note: "Private synthetic staffing detail" };
    expect(shiftCreateFingerprint(shift)).toBe(shiftCreateFingerprint({ ...shift, note: "Different private detail" }));
    expect(sameShiftPrivateNote({ note: shift.note }, shift.note)).toBe(true);
    const handover = { centreId: "centre", outgoingShiftId: "shift", incomingStaffId: "staff", handoverNote: "Private synthetic handover detail" };
    expect(handoverCreateFingerprint(handover)).toBe(handoverCreateFingerprint({ ...handover, handoverNote: "Different private detail" }));
    expect(sameHandoverPrivateNote({ handoverNote: handover.handoverNote }, handover.handoverNote)).toBe(true);
  });

  it("keeps cancellation reasons out of action hashes and checks encrypted event values", () => {
    const first = { centreId: "centre", expectedVersion: 1, action: "CANCEL", reason: "Synthetic reason A" };
    expect(handoverActionFingerprint("handover", first)).toBe(handoverActionFingerprint("handover", { ...first, reason: "Synthetic reason B" }));
    expect(sameHandoverActionReason({ reason: first.reason }, first.reason)).toBe(true);
    expect(sameHandoverActionReason({ reason: first.reason }, "Synthetic reason B")).toBe(false);
  });
});
