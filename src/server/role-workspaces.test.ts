import { describe, expect, it } from "vitest";
import { canReadTaskQueue, getRoleWorkspaceCapabilities, getRoleWorkspaceLinks, getRoleWorkspacePanels, hasOverlappingPermissionScope, usesDailyCollectionSchedule } from "./role-workspaces";

describe("role workspace permission filtering", () => {
  it("requires a shared centre scope for combined operational permissions", () => {
    expect(hasOverlappingPermissionScope([{ key: "tasks.approve", centreId: "c1" }, { key: "tasks.read", centreId: "c2" }], ["tasks.approve", "tasks.read"])).toBe(false);
    expect(hasOverlappingPermissionScope([{ key: "tasks.approve", centreId: "c1" }, { key: "tasks.read", centreId: null }], ["tasks.approve", "tasks.read"])).toBe(true);
    expect(hasOverlappingPermissionScope([{ key: "tasks.approve", centreId: null }, { key: "tasks.read", centreId: "c2" }], ["tasks.approve", "tasks.read"])).toBe(true);
    expect(hasOverlappingPermissionScope([{ key: "tasks.approve", centreId: "c1" }, { key: "tasks.read", centreId: "c1" }, { key: "tasks.read", centreId: "c2" }], ["tasks.approve", "tasks.read"])).toBe(true);
  });
  it("gates embedded create controls on read and mutation grants in the same centre", () => {
    const split = [
      { key: "patients.read", centreId: "c1" }, { key: "patients.create", centreId: "c2" },
      { key: "appointments.read", centreId: "c1" }, { key: "appointments.create", centreId: "c2" }, { key: "appointments.update", centreId: "c2" },
      { key: "orders.read", centreId: "c1" }, { key: "orders.create", centreId: "c2" },
    ];
    expect(getRoleWorkspaceCapabilities(split)).toEqual({ createPatient: false, createAppointment: false, manageWalkIn: false, createOrder: false, createSupportTask: false });
    const overlapping = [...split, { key: "patients.create", centreId: "c1" }, { key: "appointments.create", centreId: "c1" }, { key: "appointments.update", centreId: "c1" }, { key: "orders.create", centreId: "c1" }, { key: "tasks.create", centreId: "c2" }, { key: "tasks.support.create", centreId: "c2" }];
    expect(getRoleWorkspaceCapabilities(overlapping)).toEqual({ createPatient: true, createAppointment: true, manageWalkIn: true, createOrder: true, createSupportTask: true });
  });
  it("keeps support request creation disabled when grants are split across centres", () => {
    expect(getRoleWorkspaceCapabilities([{ key: "tasks.create", centreId: "c1" }, { key: "tasks.support.create", centreId: "c2" }]).createSupportTask).toBe(false);
    expect(getRoleWorkspaceCapabilities([{ key: "tasks.create", centreId: null }, { key: "tasks.support.create", centreId: "c2" }]).createSupportTask).toBe(true);
  });
  it("does not surface follow-up, approval, or support creation workspaces for disjoint grants", () => {
    const disjoint = [{ key: "leads.read", centreId: "c1" }, { key: "leads.followups.manage", centreId: "c2" }, { key: "reports.read", centreId: "c1" }, { key: "reports.followups.manage", centreId: "c2" }, { key: "tasks.approve", centreId: "c1" }, { key: "tasks.read", centreId: "c2" }, { key: "tasks.create", centreId: "c1" }, { key: "tasks.support.create", centreId: "c2" }];
    expect(getRoleWorkspaceLinks("sales", disjoint).some(([href]) => href === "/leads/followups")).toBe(false);
    expect(getRoleWorkspaceLinks("support", disjoint).some(([href]) => href === "/reports/followups")).toBe(false);
    expect(getRoleWorkspaceLinks("manager", disjoint).some(([href]) => href === "/tasks/approvals")).toBe(false);
    expect(getRoleWorkspacePanels("sales", disjoint)).not.toContain("sales_followups");
    expect(getRoleWorkspacePanels("support", disjoint)).not.toContain("report_followups");
    expect(getRoleWorkspacePanels("reception", disjoint)).not.toContain("support_requests");
    expect(getRoleWorkspacePanels("manager", disjoint)).not.toContain("approval_queue");
  });
  it("uses the date-filtered personal schedule only for phlebotomists", () => {
    expect(usesDailyCollectionSchedule("phlebotomist")).toBe(true);
    expect(usesDailyCollectionSchedule("manager")).toBe(false);
    expect(usesDailyCollectionSchedule("owner")).toBe(false);
  });
  it("shows the assigned collection workbench to visit-only phlebotomists", () => {
    expect(getRoleWorkspacePanels("phlebotomist", [{ key: "collections.visit.record", centreId: "c1" }])).toContain("collection_work");
    expect(getRoleWorkspacePanels("support", [{ key: "collections.visit.record", centreId: "c1" }])).not.toContain("collection_work");
    expect(getRoleWorkspacePanels("manager", [{ key: "collections.visit.record", centreId: "c1" }])).not.toContain("collection_work");
  });
  it("shows the awaiting-receiving queue to phlebotomists with sample read access, not unrelated roles", () => {
    expect(getRoleWorkspacePanels("phlebotomist", [{ key: "samples.read", centreId: "c1" }])).toContain("sample_handover");
    expect(getRoleWorkspacePanels("manager", [{ key: "samples.read", centreId: "c1" }])).not.toContain("sample_handover");
  });
  it("shows shift handover only to staff with the dedicated handover grant", () => {
    expect(getRoleWorkspaceLinks("reception", [{ key: "roster.read", centreId: "c1" }]).some(([href]) => href === "/roster/handovers")).toBe(false);
    expect(getRoleWorkspaceLinks("reception", [{ key: "roster.handover", centreId: "c1" }]).some(([href]) => href === "/roster/handovers")).toBe(true);
  });
  it("provides phlebotomists their own roster and workload panel when roster access is granted", () => {
    expect(getRoleWorkspacePanels("phlebotomist", [{ key: "roster.read", centreId: "c1" }])).toContain("roster_workload");
    expect(getRoleWorkspacePanels("phlebotomist", [])).not.toContain("roster_workload");
    expect(getRoleWorkspacePanels("manager", [{ key: "roster.read", centreId: "c1" }])).toContain("roster_workload");
  });
  it("shows only granted operational destinations", () => {
    const links = getRoleWorkspaceLinks("phlebotomist", [{ key: "collections.visit.record", centreId: "c1" }]);
    expect(links.map(([href]) => href)).toEqual(["/field/today"]);
  });
  it("exposes the aggregate CRM acquisition view in Sales and Owner workspaces only with lead read access", () => {
    expect(getRoleWorkspaceLinks("sales", []).some(([href]) => href === "/leads/analytics")).toBe(false);
    expect(getRoleWorkspaceLinks("sales", [{ key: "leads.read", centreId: "c1" }]).some(([href]) => href === "/leads/analytics")).toBe(true);
    expect(getRoleWorkspaceLinks("owner", [{ key: "organization.read", centreId: null }]).some(([href]) => href === "/leads/analytics")).toBe(false);
    expect(getRoleWorkspaceLinks("owner", [{ key: "leads.read", centreId: null }]).some(([href]) => href === "/leads/analytics")).toBe(true);
  });
  it("shows corporate and partner directories only to the corresponding relationship readers", () => {
    const corporateOnly = getRoleWorkspaceLinks("sales", [{ key: "corporate.read", centreId: "c1" }]).map(([href]) => href);
    expect(corporateOnly).toContain("/relationships/corporate");
    expect(corporateOnly).not.toContain("/relationships/partners");
    const both = getRoleWorkspaceLinks("owner", [{ key: "corporate.read", centreId: "c1" }, { key: "partners.read", centreId: "c2" }]).map(([href]) => href);
    expect(both).toContain("/relationships/corporate");
    expect(both).toContain("/relationships/partners");
  });
  it("shows an assigned-only appointment queue to any role without broad appointment access", () => {
    expect(getRoleWorkspacePanels("phlebotomist", [{ key: "appointments.assigned.read", centreId: "c1" }])).toContain("assigned_appointments");
    expect(getRoleWorkspacePanels("support", [{ key: "appointments.assigned.read", centreId: "c1" }])).toContain("assigned_appointments");
    expect(getRoleWorkspacePanels("manager", [{ key: "appointments.read", centreId: "c1" }, { key: "appointments.assigned.read", centreId: "c1" }])).not.toContain("assigned_appointments");
    expect(getRoleWorkspacePanels("sales", [{ key: "workspace.read", centreId: "c1" }])).not.toContain("assigned_appointments");
  });
  it("keeps owner tools behind their specific grants", () => {
    const links = getRoleWorkspaceLinks("owner", [{ key: "organization.read", centreId: null }]);
    expect(links.map(([href]) => href)).toEqual(["/branch/operations", "/owner"]);
  });
  it("shows centre task approval policy configuration only to policy managers", () => {
    expect(getRoleWorkspaceLinks("manager", [{ key: "tasks.approve", centreId: "c1" }]).some(([href]) => href === "/tasks/approvals/policies")).toBe(false);
    expect(getRoleWorkspaceLinks("manager", [{ key: "tasks.policy.manage", centreId: "c1" }]).some(([href]) => href === "/tasks/approvals/policies")).toBe(true);
  });
  it("does not advertise the centre-wide approval queue without task-read scope", () => {
    const approvalOnly = [{ key: "tasks.approve", centreId: "c1" }];
    const assignedOnly = [{ key: "tasks.approve", centreId: "c1" }, { key: "tasks.assigned.read", centreId: "c1" }];
    const readableApprover = [{ key: "tasks.approve", centreId: "c1" }, { key: "tasks.read", centreId: "c1" }];
    expect(getRoleWorkspaceLinks("manager", approvalOnly).some(([href]) => href === "/tasks/approvals")).toBe(false);
    expect(getRoleWorkspacePanels("manager", approvalOnly)).not.toContain("approval_queue");
    expect(getRoleWorkspaceLinks("manager", assignedOnly).some(([href]) => href === "/tasks/approvals")).toBe(false);
    expect(getRoleWorkspacePanels("manager", assignedOnly)).not.toContain("approval_queue");
    expect(getRoleWorkspaceLinks("manager", readableApprover).some(([href]) => href === "/tasks/approvals")).toBe(true);
    expect(getRoleWorkspacePanels("manager", readableApprover)).toContain("approval_queue");
  });
  it("gives Accounts direct authorized finance queues without exposing them to task-only staff", () => {
    const financeLinks = getRoleWorkspaceLinks("accounts", [{ key: "finance.read", centreId: "c1" }]).map(([href]) => href);
    expect(financeLinks).toEqual(["/finance", "/finance/payments", "/finance/outstanding", "/finance/exceptions", "/finance/refunds", "/finance/reconciliation"]);
    expect(getRoleWorkspaceLinks("accounts", [{ key: "tasks.assigned.read", centreId: "c1" }]).map(([href]) => href)).toEqual(["/tasks"]);
  });
  it("embeds finance status only for Reception and Manager sessions with the finance grant", () => {
    expect(getRoleWorkspacePanels("reception", [{ key: "finance.read", centreId: "c1" }])).toContain("finance_operations");
    expect(getRoleWorkspacePanels("manager", [{ key: "finance.read", centreId: "c1" }])).toContain("finance_operations");
    expect(getRoleWorkspacePanels("reception", [{ key: "appointments.read", centreId: "c1" }])).not.toContain("finance_operations");
    expect(getRoleWorkspacePanels("manager", [{ key: "workspace.read", centreId: "c1" }])).not.toContain("finance_operations");
  });
  it("embeds the existing finance dashboard in Owner workspace only with finance read access", () => {
    expect(getRoleWorkspacePanels("owner", [{ key: "workspace.read", centreId: null }])).not.toContain("finance_operations");
    expect(getRoleWorkspacePanels("owner", [{ key: "finance.read", centreId: null }])).toContain("finance_operations");
  });
  it("shows assigned enquiry callbacks in Reception only with both CRM grants", () => {
    expect(getRoleWorkspacePanels("reception", [{ key: "leads.read", centreId: "c1" }])).not.toContain("sales_followups");
    expect(getRoleWorkspacePanels("reception", [{ key: "leads.followups.manage", centreId: "c1" }])).not.toContain("sales_followups");
    expect(getRoleWorkspacePanels("reception", [{ key: "leads.read", centreId: "c1" }, { key: "leads.followups.manage", centreId: "c1" }])).toContain("sales_followups");
  });
  it("exposes walk-in coordination only to staff with appointment creation permission", () => {
    expect(getRoleWorkspaceLinks("reception", [{ key: "patients.read", centreId: "c1" }]).some(([href]) => href.includes("source=WALK_IN"))).toBe(false);
    expect(getRoleWorkspaceLinks("reception", [{ key: "appointments.create", centreId: "c1" }]).some(([href]) => href === "/appointments/new?source=WALK_IN")).toBe(true);
  });
  it("embeds Reception patient lookup only for patient readers and gates registration separately", () => {
    expect(getRoleWorkspacePanels("reception", [{ key: "patients.create", centreId: "c1" }])).not.toContain("patient_directory");
    expect(getRoleWorkspacePanels("reception", [{ key: "patients.read", centreId: "c1" }])).toContain("patient_directory");
    expect(getRoleWorkspacePanels("manager", [{ key: "patients.read", centreId: "c1" }])).not.toContain("patient_directory");
  });
  it("embeds public enquiry review in Reception only when CRM read is granted", () => {
    expect(getRoleWorkspacePanels("reception", [])).not.toContain("public_enquiries");
    expect(getRoleWorkspacePanels("reception", [{ key: "leads.read", centreId: "c1" }])).toContain("public_enquiries");
    expect(getRoleWorkspacePanels("manager", [{ key: "leads.read", centreId: "c1" }])).not.toContain("public_enquiries");
    expect(getRoleWorkspacePanels("reception", [{ key: "leads.create", centreId: "c1" }])).not.toContain("public_enquiries");
  });
  it("embeds only role work panels authorized by the staff grants", () => {
    expect(getRoleWorkspacePanels("reception", [{ key: "appointments.read", centreId: "c1" }, { key: "tasks.assigned.read", centreId: "c1" }])).toEqual(["confirmation_queue", "arrival_queue", "appointment_schedule", "walk_in_queue", "support_requests", "staff_tasks"]);
    expect(getRoleWorkspacePanels("reception", [{ key: "appointments.read", centreId: "c1" }, { key: "appointments.update", centreId: "c1" }])).toContain("walk_in_tokens");
    expect(getRoleWorkspacePanels("reception", [{ key: "appointments.read", centreId: "c1" }, { key: "appointments.update", centreId: "c2" }])).not.toContain("walk_in_tokens");
    expect(getRoleWorkspacePanels("reception", [{ key: "appointments.read", centreId: "c1" }])).not.toContain("walk_in_tokens");
    expect(getRoleWorkspacePanels("manager", [{ key: "appointments.read", centreId: "c1" }])).toEqual(["confirmation_queue", "arrival_queue", "appointment_schedule", "walk_in_queue"]);
    expect(getRoleWorkspacePanels("manager", [{ key: "appointments.read", centreId: "c1" }, { key: "appointments.update", centreId: "c1" }])).toContain("walk_in_tokens");
    expect(getRoleWorkspacePanels("manager", [{ key: "appointments.update", centreId: "c1" }])).not.toContain("walk_in_tokens");
    expect(getRoleWorkspacePanels("reception", [{ key: "orders.read", centreId: "c1" }])).toEqual(["order_coordination"]);
    expect(getRoleWorkspacePanels("manager", [{ key: "orders.read", centreId: "c1" }])).toEqual(["order_coordination"]);
    expect(getRoleWorkspacePanels("manager", [{ key: "collections.read", centreId: "c1" }])).toEqual(["collection_work"]);
    expect(getRoleWorkspaceLinks("manager", [{ key: "samples.receive", centreId: "c1" }, { key: "samples.dispatch", centreId: "c1" }]).map(([href]) => href)).toEqual(["/branch/receiving", "/branch/dispatch"]);
    expect(getRoleWorkspacePanels("manager", [{ key: "samples.receive", centreId: "c1" }, { key: "samples.dispatch", centreId: "c1" }])).toEqual(["sample_receiving", "sample_dispatch"]);
    expect(getRoleWorkspacePanels("phlebotomist", [{ key: "samples.read", centreId: "c1" }])).toEqual(["sample_handover", "sample_exceptions"]);
    expect(getRoleWorkspacePanels("phlebotomist", [{ key: "samples.exceptions.manage", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("manager", [{ key: "samples.read", centreId: "c1" }])).toEqual(["sample_exceptions"]);
    expect(getRoleWorkspacePanels("manager", [{ key: "samples.exceptions.manage", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("reception", [{ key: "samples.receive", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("sales", [{ key: "orders.read", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("sales", [{ key: "leads.read", centreId: "c1" }])).toEqual(["sales_pipeline"]);
    expect(getRoleWorkspacePanels("sales", [{ key: "leads.read", centreId: "c1" }, { key: "leads.followups.manage", centreId: "c1" }])).toEqual(["sales_pipeline", "sales_followups"]);
    expect(getRoleWorkspacePanels("manager", [{ key: "tasks.approve", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("manager", [{ key: "tasks.approve", centreId: "c1" }, { key: "tasks.read", centreId: "c1" }])).toEqual(["approval_queue", "staff_tasks"]);
    expect(getRoleWorkspacePanels("accounts", [{ key: "workspace.read", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("accounts", [{ key: "finance.read", centreId: "c1" }])).toEqual(["finance_operations"]);
    expect(getRoleWorkspacePanels("support", [{ key: "reports.read", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("support", [{ key: "reports.followups.manage", centreId: "c1" }])).toEqual([]);
    const reportFollowupGrants = [{ key: "reports.read", centreId: "c1" }, { key: "reports.followups.manage", centreId: "c1" }];
    expect(getRoleWorkspacePanels("support", reportFollowupGrants)).toEqual(["report_followups"]);
    expect(getRoleWorkspacePanels("manager", reportFollowupGrants)).toEqual(["report_followups"]);
    expect(getRoleWorkspacePanels("owner", [{ key: "reports.read", centreId: null }, { key: "reports.followups.manage", centreId: null }])).toEqual(["report_followups"]);
    expect(getRoleWorkspaceLinks("manager", [{ key: "reports.followups.manage", centreId: "c1" }]).some(([href]) => href === "/reports/followups")).toBe(false);
    expect(getRoleWorkspaceLinks("manager", reportFollowupGrants).some(([href]) => href === "/reports/followups")).toBe(true);
    expect(getRoleWorkspacePanels("support", [{ key: "tasks.assigned.read", centreId: "c1" }, { key: "tasks.create", centreId: "c1" }])).toEqual(["support_requests", "staff_tasks"]);
    expect(getRoleWorkspacePanels("support", [{ key: "tasks.support.read", centreId: "c1" }])).toEqual(["support_requests"]);
    expect(getRoleWorkspacePanels("manager", [{ key: "tasks.support.read", centreId: "c1" }])).toEqual(["support_requests"]);
    expect(getRoleWorkspacePanels("support", [{ key: "escalations.assigned.read", centreId: "c1" }])).toEqual(["escalation_work"]);
    expect(getRoleWorkspacePanels("sales", [{ key: "escalations.assigned.read", centreId: "c1" }])).toEqual(["escalation_work"]);
    expect(getRoleWorkspacePanels("reception", [{ key: "tasks.create", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("reception", [{ key: "tasks.assigned.read", centreId: "c1" }])).toEqual(["support_requests", "staff_tasks"]);
    expect(getRoleWorkspacePanels("support", [{ key: "tasks.support.create", centreId: "c1" }])).toEqual([]);
    expect(getRoleWorkspacePanels("support", [{ key: "tasks.create", centreId: "c1" }, { key: "tasks.support.create", centreId: "c1" }])).toEqual(["support_requests"]);
    expect(canReadTaskQueue([{ key: "tasks.support.create", centreId: "c1" }])).toBe(false);
    expect(canReadTaskQueue([{ key: "tasks.support.read", centreId: "c1" }])).toBe(true);
    expect(canReadTaskQueue([{ key: "tasks.assigned.read", centreId: "c1" }])).toBe(true);
    expect(canReadTaskQueue([{ key: "tasks.read", centreId: "c1" }])).toBe(true);
    expect(canReadTaskQueue([{ key: "workspace.read", centreId: null }])).toBe(false);
  });
});
