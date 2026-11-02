export type ReportStatus="AWAITING_REPORT"|"QUARANTINED"|"PENDING_VERIFICATION"|"VERIFIED"|"APPROVED_FOR_RELEASE"|"DELIVERY_PENDING"|"DELIVERED"|"SUPERSEDED"|"ON_HOLD"|"EXCEPTION";
const transitions:Record<ReportStatus,ReportStatus[]>={
  AWAITING_REPORT:["QUARANTINED","PENDING_VERIFICATION","ON_HOLD"],QUARANTINED:["PENDING_VERIFICATION","ON_HOLD"],PENDING_VERIFICATION:["VERIFIED","ON_HOLD","QUARANTINED"],VERIFIED:["APPROVED_FOR_RELEASE","ON_HOLD"],APPROVED_FOR_RELEASE:["DELIVERY_PENDING","DELIVERED","SUPERSEDED","ON_HOLD"],DELIVERY_PENDING:["DELIVERED","ON_HOLD"],DELIVERED:["SUPERSEDED"],SUPERSEDED:[],ON_HOLD:["PENDING_VERIFICATION","QUARANTINED","EXCEPTION"],EXCEPTION:["PENDING_VERIFICATION","QUARANTINED","ON_HOLD"],
};
export function canTransitionReport(from:ReportStatus,to:ReportStatus){return from===to||transitions[from].includes(to);}
export function canVerifyReport({status,scanStatus,uploaderId,actorId}:{status:ReportStatus;scanStatus:string|null;uploaderId:string;actorId:string}){return status==="PENDING_VERIFICATION"&&scanStatus==="CLEAN"&&uploaderId!==actorId;}
export function canApproveReportRelease({status,verifiedBy,actorId}:{status:ReportStatus;verifiedBy:string|null;actorId:string}){return status==="VERIFIED"&&verifiedBy!==null&&verifiedBy!==actorId;}
export function deliveryResultStatus(outcome:"ATTEMPTED"|"FAILED"|"ACKNOWLEDGED"):ReportStatus{return outcome==="ACKNOWLEDGED"?"DELIVERED":"DELIVERY_PENDING";}
