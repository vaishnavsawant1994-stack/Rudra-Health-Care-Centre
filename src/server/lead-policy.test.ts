import { describe, expect, it } from "vitest";
import { canTransitionLead, communicationDraftDenial, hasLeadCentrePermission, leadActivitySchema, leadContactAllowed, leadCreateSchema, leadFollowupUpdateSchema, leadUpdateSchema, visibleLeadCentres } from "./lead-policy";

const centre = "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34";

describe("lead CRM policy", () => {
  it("requires a usable contact method and normalizes it", () => {
    const base = { centreId: centre, firstName: "Synthetic", lastName: "Enquirer", enquiryCategory: "GENERAL", source: "WALK_IN" };
    expect(leadCreateSchema.safeParse(base).success).toBe(false);
    const parsed = leadCreateSchema.safeParse({ ...base, phone: "+91 98765 43210" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.phone).toBe("+919876543210");
  });

  it("accepts a doctor-attributed referral only with referral source and a contact method", () => {
    const base = { centreId: centre, firstName: "Synthetic", lastName: "Referral", enquiryCategory: "GENERAL", source: "REFERRAL", sourceDoctorId: "c3000000-0000-4000-8000-000000000002" };
    expect(leadCreateSchema.safeParse(base).success).toBe(false);
    const parsed = leadCreateSchema.safeParse({ ...base, phone: "+919876543210" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ source: "REFERRAL", sourceDoctorId: base.sourceDoctorId, phone: "+919876543210", priority: "NORMAL", preferredChannel: "PHONE", homeCollectionInterest: false });
    expect(leadCreateSchema.safeParse({ ...base, phone: "+919876543210", source: "MANUAL" }).success).toBe(false);
  });

  it("requires evidence for permission changes and a reason for lost or DNC statuses", () => {
    expect(leadUpdateSchema.safeParse({ contactPermission: "AUTHORIZED" }).success).toBe(false);
    expect(leadUpdateSchema.safeParse({ contactPermission: "WITHDRAWN", contactEvidenceReference: "CASE-TEST-1" }).success).toBe(true);
    expect(leadUpdateSchema.safeParse({ marketingConsent: "GRANTED" }).success).toBe(false);
    expect(leadUpdateSchema.safeParse({ status: "LOST" }).success).toBe(false);
    expect(leadUpdateSchema.safeParse({ status: "DO_NOT_CONTACT", statusReason: "Customer requested no contact", lostReason: "Customer requested no contact" }).success).toBe(true);
    expect(leadUpdateSchema.safeParse({ status: "QUALIFIED" }).success).toBe(false);
    expect(leadUpdateSchema.safeParse({ statusReason: "Updated status reason" }).success).toBe(false);
  });

  it("allows an operational contact only when separately authorized", () => {
    expect(leadContactAllowed({ status: "NEW", contactPermission: "AUTHORIZED" })).toBe(true);
    expect(leadContactAllowed({ status: "DO_NOT_CONTACT", contactPermission: "AUTHORIZED" })).toBe(false);
    expect(leadContactAllowed({ status: "NEW", contactPermission: "WITHDRAWN" })).toBe(false);
    expect(leadContactAllowed({ status: "NEW", contactPermission: "PENDING" })).toBe(false);
  });

  it("gates encrypted communication drafts by channel, contact permission, lead state and separate marketing consent", () => {
    const input = { status: "QUALIFIED", contactPermission: "AUTHORIZED", preferredChannel: "EMAIL", marketingConsent: "NOT_REQUESTED", purpose: "OPERATIONAL" as const, channel: "EMAIL" };
    expect(communicationDraftDenial(input)).toBeNull();
    expect(communicationDraftDenial({ ...input, purpose: "MARKETING" })).toBe("marketing_consent_required");
    expect(communicationDraftDenial({ ...input, contactPermission: "WITHDRAWN" })).toBe("contact_permission_required");
    expect(communicationDraftDenial({ ...input, status: "LOST" })).toBe("lead_not_contactable");
    expect(communicationDraftDenial({ ...input, status: "DO_NOT_CONTACT" })).toBe("contact_permission_required");
    expect(communicationDraftDenial({ ...input, channel: "PHONE" })).toBe("preferred_channel_mismatch");
    expect(communicationDraftDenial({ ...input, purpose: "MARKETING", marketingConsent: "GRANTED" })).toBeNull();
  });

  it("enforces lifecycle order and delegated reopen permission", () => {
    expect(canTransitionLead({ from: "NEW", to: "QUALIFIED", canReopen: false, contactPermission: "PENDING", hasContactEvidence: false })).toBe(true);
    expect(canTransitionLead({ from: "NEW", to: "CONVERTED", canReopen: true, contactPermission: "AUTHORIZED", hasContactEvidence: true })).toBe(false);
    expect(canTransitionLead({ from: "LOST", to: "NEW", canReopen: false, contactPermission: "PENDING", hasContactEvidence: false })).toBe(false);
    expect(canTransitionLead({ from: "DO_NOT_CONTACT", to: "NEW", canReopen: true, contactPermission: "WITHDRAWN", hasContactEvidence: true })).toBe(false);
    expect(canTransitionLead({ from: "DO_NOT_CONTACT", to: "NEW", canReopen: true, contactPermission: "AUTHORIZED", hasContactEvidence: true })).toBe(true);
  });

  it("requires outcomes for terminal follow-ups and validates activity inputs", () => {
    expect(leadFollowupUpdateSchema.safeParse({ status: "COMPLETED" }).success).toBe(false);
    expect(leadFollowupUpdateSchema.safeParse({ status: "COMPLETED", outcome: "CONTACTED" }).success).toBe(true);
    expect(leadActivitySchema.safeParse({ activityType: "NOTE", body: "Operational callback requested" }).success).toBe(true);
    expect(leadActivitySchema.safeParse({ activityType: "CONTACT_ATTEMPT", body: "Tried phone", outcome: "NO_ANSWER" }).success).toBe(true);
  });

  it("keeps CRM permissions centre scoped", () => {
    const grants = [{ key: "leads.read", centreId: centre }, { key: "leads.create", centreId: null }, { key: "appointments.create", centreId: centre }];
    expect(hasLeadCentrePermission(grants, "leads.read", centre)).toBe(true);
    expect(hasLeadCentrePermission(grants, "leads.read", "other-centre")).toBe(false);
    expect(hasLeadCentrePermission(grants, "appointments.create", centre)).toBe(true);
    expect(hasLeadCentrePermission(grants, "appointments.create", "other-centre")).toBe(false);
    expect(visibleLeadCentres(grants, "leads.read")).toEqual([centre]);
    expect(visibleLeadCentres(grants, "leads.create")).toBeNull();
  });
});
