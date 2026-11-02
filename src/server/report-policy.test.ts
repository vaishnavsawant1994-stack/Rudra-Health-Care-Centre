import {describe,expect,it} from "vitest";
import {canApproveReportRelease,canTransitionReport,canVerifyReport,deliveryResultStatus} from "./report-policy";

describe("report handling boundaries",()=>{
  it("allows only explicit report lifecycle transitions",()=>{expect(canTransitionReport("AWAITING_REPORT","PENDING_VERIFICATION")).toBe(true);expect(canTransitionReport("DELIVERED","PENDING_VERIFICATION")).toBe(false);expect(canTransitionReport("SUPERSEDED","DELIVERED")).toBe(false);});
  it("requires a clean scan and independent verifier",()=>{expect(canVerifyReport({status:"PENDING_VERIFICATION",scanStatus:"QUARANTINED",uploaderId:"u1",actorId:"u2"})).toBe(false);expect(canVerifyReport({status:"PENDING_VERIFICATION",scanStatus:"CLEAN",uploaderId:"u1",actorId:"u1"})).toBe(false);expect(canVerifyReport({status:"PENDING_VERIFICATION",scanStatus:"CLEAN",uploaderId:"u1",actorId:"u2"})).toBe(true);});
  it("requires an independent release approver",()=>{expect(canApproveReportRelease({status:"VERIFIED",verifiedBy:"u1",actorId:"u1"})).toBe(false);expect(canApproveReportRelease({status:"VERIFIED",verifiedBy:"u1",actorId:"u2"})).toBe(true);});
  it("marks delivered only on acknowledged handoff",()=>{expect(deliveryResultStatus("ATTEMPTED")).toBe("DELIVERY_PENDING");expect(deliveryResultStatus("FAILED")).toBe("DELIVERY_PENDING");expect(deliveryResultStatus("ACKNOWLEDGED")).toBe("DELIVERED");});
});
