import { describe, expect, it } from "vitest";
import { isSupportTicketRecord } from "./support-ticket-access";

describe("support ticket detail classification", () => {
  it("allows the support workbench to render only a support-request task", () => {
    expect(isSupportTicketRecord({ id: "opaque-id", taskType: "SUPPORT_REQUEST" })).toBe(true);
    expect(isSupportTicketRecord({ id: "opaque-id", taskType: "GENERAL" })).toBe(false);
    expect(isSupportTicketRecord(null)).toBe(false);
    expect(isSupportTicketRecord({ taskType: 1 })).toBe(false);
  });
});
