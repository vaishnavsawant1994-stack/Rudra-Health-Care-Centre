import { describe, expect, it } from "vitest";
import { getActionCentreAccess } from "./action-centre-policy";

describe("Action Centre permission projection", () => {
  it("keeps assigned-only work separate from management authority", () => {
    expect(getActionCentreAccess([{ key: "tasks.assigned.read", centreId: "centre-a" }])).toEqual({
      tasks: true, taskManagement: false, taskCreate: false, taskUpdate: false, taskApprove: false, taskAssign: false,
      escalations: false, escalationCreate: false, escalationManage: false,
      operationalQueues: false, appointments: false, assignedAppointmentsOnly: false, orders: false, collections: false, sampleRead: false, sampleReceive: false, sampleDispatch: false, finance: false, leads: false, reportFollowups: false, reports: false, leadFollowups: false, roster: false,
    });
  });

  it("exposes only the permitted task and escalation controls", () => {
    expect(getActionCentreAccess([
      { key: "tasks.read", centreId: "centre-a" },
      { key: "tasks.approve", centreId: "centre-a" },
      { key: "escalations.assigned.read", centreId: "centre-a" },
    ])).toEqual({
      tasks: true, taskManagement: true, taskCreate: false, taskUpdate: false, taskApprove: true, taskAssign: false,
      escalations: true, escalationCreate: false, escalationManage: false,
      operationalQueues: false, appointments: false, assignedAppointmentsOnly: false, orders: false, collections: false, sampleRead: false, sampleReceive: false, sampleDispatch: false, finance: false, leads: false, reportFollowups: false, reports: false, leadFollowups: false, roster: false,
    });
  });

  it("does not grant access from unrelated workspace permission", () => {
    expect(getActionCentreAccess([{ key: "workspace.read", centreId: "centre-a" }])).toEqual({
      tasks: false, taskManagement: false, taskCreate: false, taskUpdate: false, taskApprove: false, taskAssign: false,
      escalations: false, escalationCreate: false, escalationManage: false,
      operationalQueues: false, appointments: false, assignedAppointmentsOnly: false, orders: false, collections: false, sampleRead: false, sampleReceive: false, sampleDispatch: false, finance: false, leads: false, reportFollowups: false, reports: false, leadFollowups: false, roster: false,
    });
  });
  it("opens the source-record action centre only for relevant authorized queues", () => {
    expect(getActionCentreAccess([{ key: "appointments.read", centreId: "centre-a" }])).toMatchObject({ operationalQueues: true, appointments: true, orders: false });
    expect(getActionCentreAccess([{ key: "appointments.assigned.read", centreId: "centre-a" }])).toMatchObject({ operationalQueues: true, appointments: true, assignedAppointmentsOnly: true });
    expect(getActionCentreAccess([{ key: "appointments.read", centreId: "centre-a" }, { key: "appointments.assigned.read", centreId: "centre-a" }])).toMatchObject({ assignedAppointmentsOnly: false });
    expect(getActionCentreAccess([{ key: "reports.read", centreId: "centre-a" }])).toMatchObject({ operationalQueues: true, reportFollowups: false });
    expect(getActionCentreAccess([{ key: "reports.read", centreId: "centre-a" }, { key: "reports.followups.manage", centreId: "centre-a" }])).toMatchObject({ reportFollowups: true });
    expect(getActionCentreAccess([{ key: "workspace.read", centreId: "centre-a" }])).toMatchObject({ operationalQueues: false });
    expect(getActionCentreAccess([{ key: "collections.assign", centreId: "centre-a" }])).toMatchObject({ operationalQueues: false, collections: false });
  });
});
