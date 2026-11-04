import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { visibleLeadCentres } from "@/server/lead-policy";
import { canApproveReportRelease,canTransitionReport,canVerifyReport,deliveryResultStatus,type ReportStatus } from "@/server/report-policy";
import { decryptFinanceReportPrivateData, encryptFinanceReportPrivateData } from "@/server/finance-report-crypto";

const id = z.uuid();
const reference = z.string().trim().min(2).max(200);
const actions = z.discriminatedUnion("action", [
  z.object({ action:z.literal("register"), centreId:id, orderId:id, externalReference:z.string().trim().max(160).optional(), externalIssuedAt:z.iso.datetime().optional() }),
  z.object({ action:z.literal("verify"), reportId:id, reason:reference, evidenceReference:reference }),
  z.object({ action:z.literal("approve_release"), reportId:id, reason:reference }),
  z.object({ action:z.literal("hold"), reportId:id, reason:reference }),
  z.object({ action:z.literal("clear_hold"), reportId:id, reason:reference }),
  z.object({ action:z.literal("raise_exception"), reportId:id, reason:reference, evidenceReference:z.string().trim().max(200).optional() }),
  z.object({ action:z.literal("resolve_exception"), reportId:id, reason:reference }),
  z.object({ action:z.literal("delivery"), reportId:id, recipientLabel:z.string().trim().min(2).max(120), recipientVerificationReference:reference, channel:z.enum(["PHYSICAL_COLLECTION","AUTHORIZED_STAFF_HANDOFF"]), outcome:z.enum(["ATTEMPTED","FAILED","ACKNOWLEDGED"]), evidenceReference:z.string().trim().max(200).optional() }),
  z.object({ action:z.literal("supersede"), reportId:id, reason:reference, externalReference:z.string().trim().max(160).optional() }),
]);

function privatePayload(value: unknown, organizationId: string, centreId: string, recordId: string) {
  return encryptFinanceReportPrivateData("report-private", value, { organizationId, centreId, recordId });
}

export async function GET(request:Request) {
  const params=new URL(request.url).searchParams;
  const centreId=params.get("centreId")??undefined;
  if(centreId&&!id.safeParse(centreId).success)return Response.json({error:"invalid_centre"},{status:400});
  const access=await getApiAccess("reports.read",centreId);if(access.response)return access.response;
  const scopes=visibleLeadCentres(access.staff.grants,"reports.read");
  if(centreId&&scopes&&!scopes.includes(centreId))return Response.json({error:"forbidden"},{status:403});
  const clauses=[sql`r.organization_id=${access.staff.organizationId}`];
  if(centreId)clauses.push(sql`r.centre_id=${centreId}`);else if(scopes)clauses.push(scopes.length?sql`r.centre_id=ANY(${scopes}::uuid[])`:sql`false`);
  const db=getDb();
  const rows=await db.execute(sql`SELECT r.id,r.organization_id AS "organizationId",r.centre_id AS "centreId",r.private_data_ciphertext AS "privateDataCiphertext",c.name AS "centreName",r.patient_id AS "patientId",p.patient_number AS "patientNumber",r.order_id AS "orderId",o.order_number AS "orderNumber",r.report_number AS "reportNumber",r.external_issued_at AS "externalIssuedAt",r.status,r.version_number AS "versionNumber",r.supersedes_report_id AS "supersedesReportId",r.created_at AS "createdAt",r.updated_at AS "updatedAt",d.scan_status AS "scanStatus",d.sha256 AS "sha256",d.original_filename AS "filename",d.byte_size AS "byteSize" FROM diagnostic_reports r JOIN centres c ON c.id=r.centre_id AND c.organization_id=r.organization_id JOIN patients p ON p.id=r.patient_id AND p.organization_id=r.organization_id AND p.centre_id=r.centre_id JOIN diagnostic_orders o ON o.id=r.order_id AND o.organization_id=r.organization_id AND o.centre_id=r.centre_id LEFT JOIN LATERAL (SELECT scan_status,sha256,original_filename,byte_size FROM report_documents WHERE report_id=r.id AND organization_id=r.organization_id ORDER BY uploaded_at DESC LIMIT 1) d ON true WHERE ${sql.join(clauses,sql` AND `)} ORDER BY r.created_at DESC LIMIT 300`);
  const reportRows=(rows as unknown as {rows:Array<Record<string,unknown>&{id:string;organizationId:string;centreId:string;privateDataCiphertext:string}>}).rows.map(({privateDataCiphertext,...row})=>({...row,...decryptFinanceReportPrivateData<{externalReference:string|null;holdReason:string|null}>("report-private",privateDataCiphertext,{organizationId:row.organizationId,centreId:row.centreId,recordId:row.id})}));
  const centresResult=await db.execute(sql`SELECT id,name,code FROM centres WHERE organization_id=${access.staff.organizationId} AND status='ACTIVE' AND (${centreId?sql`id=${centreId}`:scopes?sql`id=ANY(${scopes}::uuid[])`:sql`true`}) ORDER BY name`);
  const canRegister=access.staff.grants.some(g=>g.key==="reports.register")&&access.staff.grants.some(g=>g.key==="orders.read")&&access.staff.grants.some(g=>g.key==="patients.read");
  const orderScope=[visibleLeadCentres(access.staff.grants,"reports.register"),visibleLeadCentres(access.staff.grants,"orders.read"),visibleLeadCentres(access.staff.grants,"patients.read")];
  const scopedOrderCentres=orderScope.filter((x):x is string[]=>x!==null);
  const authorizedOrderCentres=scopedOrderCentres.length?scopedOrderCentres.reduce((a,b)=>a.filter(v=>b.includes(v))):null;
  const orderResult=canRegister?await db.execute(sql`SELECT o.id,o.order_number AS "orderNumber",o.centre_id AS "centreId",p.patient_number AS "patientNumber" FROM diagnostic_orders o JOIN patients p ON p.id=o.patient_id AND p.organization_id=o.organization_id AND p.centre_id=o.centre_id WHERE o.organization_id=${access.staff.organizationId} AND o.status='CONFIRMED' AND (${centreId?sql`o.centre_id=${centreId}`:authorizedOrderCentres?sql`o.centre_id=ANY(${authorizedOrderCentres}::uuid[])`:sql`true`}) ORDER BY o.created_at DESC LIMIT 200`):{rows:[]};
  return Response.json({reports:reportRows,centres:(centresResult as unknown as {rows:unknown[]}).rows,confirmedOrders:(orderResult as unknown as {rows:unknown[]}).rows},{headers:{"cache-control":"private, no-store"}});
}

export async function POST(request:Request) {
  if(!isSameOriginRequest(request))return csrfRejected();
  const parsed=actions.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"invalid_report_action",fields:parsed.error.issues.map(i=>i.path.join("."))},{status:400});
  const data=parsed.data;const permission=data.action==="register"?"reports.register":data.action==="verify"?"reports.verify":data.action==="approve_release"?"reports.release":data.action==="delivery"?"reports.deliver":data.action==="hold"||data.action==="clear_hold"||data.action==="raise_exception"||data.action==="resolve_exception"?"reports.exceptions.manage":data.action==="supersede"?"reports.register":"reports.read";
  if(!z.uuid().safeParse(request.headers.get("idempotency-key")).success)return Response.json({error:"idempotency_key_required"},{status:400});
  const base=await getApiAccess(permission,data.action==="register"?data.centreId:undefined);if(base.response)return base.response;
  const db=getDb();
  try {
    const result=await db.transaction(async tx=>{
      const idemKey=request.headers.get("idempotency-key");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${base.staff.organizationId}:report-action:${idemKey??""}`},0))`);
      const previous=(await tx.execute(sql`SELECT report_id FROM report_events WHERE organization_id=${base.staff.organizationId} AND idempotency_key=${idemKey!}`) as unknown as {rows:Array<{report_id:string}>}).rows[0];
      if(previous){const prior=(await tx.execute(sql`SELECT id,status,centre_id FROM diagnostic_reports WHERE id=${previous.report_id} AND organization_id=${base.staff.organizationId}`) as unknown as {rows:Array<{id:string;status:string;centre_id:string}>}).rows[0];if(prior){const replayAccess=await getApiAccess(permission,prior.centre_id);if(replayAccess.response)throw new Error("forbidden");if(data.action==="supersede"){const correction=(await tx.execute(sql`SELECT id,status FROM diagnostic_reports WHERE supersedes_report_id=${previous.report_id} AND organization_id=${base.staff.organizationId}`) as unknown as {rows:Array<{id:string;status:string}>}).rows[0];if(correction)return {...correction,replayed:true};}return {...prior,replayed:true};}}
      if(data.action==="register"){
        const registerKey=idemKey!;
        const scoped=await getApiAccess("orders.read",data.centreId);if(scoped.response)throw new Error("forbidden");const patientAccess=await getApiAccess("patients.read",data.centreId);if(patientAccess.response)throw new Error("forbidden");
        const [order]=((await tx.execute(sql`SELECT id,patient_id,status FROM diagnostic_orders WHERE id=${data.orderId} AND organization_id=${base.staff.organizationId} AND centre_id=${data.centreId} FOR UPDATE`)) as unknown as {rows:Array<{id:string;patient_id:string;status:string}>}).rows;
        if(!order||order.status!=="CONFIRMED")throw new Error("confirmed_order_required");
        const reportId=randomUUID();const reportNumber=`RHC-R-${new Date().getFullYear()}-${reportId.slice(0,8).toUpperCase()}`;const reportPrivate=privatePayload({externalReference:data.externalReference??null,holdReason:null},base.staff.organizationId,data.centreId,reportId);
        await tx.execute(sql`INSERT INTO diagnostic_reports(id,organization_id,centre_id,patient_id,order_id,report_number,private_data_ciphertext,source,external_issued_at,status,uploader_staff_id) VALUES(${reportId},${base.staff.organizationId},${data.centreId},${order.patient_id},${data.orderId},${reportNumber},${reportPrivate},${data.externalReference?"METROPOLIS_REFERENCE":"MANUAL"},${data.externalIssuedAt??null},'AWAITING_REPORT',${base.staff.staffUserId})`);
        const eventId=randomUUID();const eventPrivate=encryptFinanceReportPrivateData("report-event",{reason:"Report reference registered",evidenceReference:null},{organizationId:base.staff.organizationId,centreId:data.centreId,recordId:eventId});await tx.execute(sql`INSERT INTO report_events(id,organization_id,centre_id,report_id,event_type,private_data_ciphertext,idempotency_key,actor_staff_id) VALUES(${eventId},${base.staff.organizationId},${data.centreId},${reportId},'REGISTERED',${eventPrivate},${registerKey},${base.staff.staffUserId})`);
        await appendAuditEvent(tx,{organizationId:base.staff.organizationId,centreId:data.centreId,actorStaffId:base.staff.staffUserId,action:"report.registered",entityType:"diagnostic_report",entityId:reportId,details:{source:data.externalReference?"METROPOLIS_REFERENCE":"MANUAL"}});
        return {id:reportId,reportNumber,status:"AWAITING_REPORT",replayed:false};
      }
      const [report]=((await tx.execute(sql`SELECT id,centre_id,patient_id,order_id,status,version_number,verified_by_staff_id,released_by_staff_id,uploader_staff_id FROM diagnostic_reports WHERE id=${data.reportId} AND organization_id=${base.staff.organizationId} FOR UPDATE`)) as unknown as {rows:Array<{id:string;centre_id:string;patient_id:string;order_id:string;status:string;version_number:number;verified_by_staff_id:string|null;released_by_staff_id:string|null;uploader_staff_id:string}>}).rows;
      if(!report)throw new Error("not_found");
      const scoped=await getApiAccess(permission,report.centre_id);if(scoped.response)throw new Error("forbidden");
      const event=async(eventType:string,reason:string,evidence?:string)=>{const eventId=randomUUID();const encrypted=encryptFinanceReportPrivateData("report-event",{reason,evidenceReference:evidence??null},{organizationId:base.staff.organizationId,centreId:report.centre_id,recordId:eventId});await tx.execute(sql`INSERT INTO report_events(id,organization_id,centre_id,report_id,event_type,private_data_ciphertext,idempotency_key,actor_staff_id) VALUES(${eventId},${base.staff.organizationId},${report.centre_id},${report.id},${eventType},${encrypted},${idemKey},${base.staff.staffUserId})`);};
      const setPrivate=async(patch:{externalReference?:string|null;holdReason?:string|null})=>{const [stored]=((await tx.execute(sql`SELECT private_data_ciphertext FROM diagnostic_reports WHERE id=${report.id} AND organization_id=${base.staff.organizationId}`)) as unknown as {rows:Array<{private_data_ciphertext:string}>}).rows;const current=decryptFinanceReportPrivateData<{externalReference:string|null;holdReason:string|null}>("report-private",stored.private_data_ciphertext,{organizationId:base.staff.organizationId,centreId:report.centre_id,recordId:report.id});const encrypted=privatePayload({...current,...patch},base.staff.organizationId,report.centre_id,report.id);await tx.execute(sql`UPDATE diagnostic_reports SET private_data_ciphertext=${encrypted} WHERE id=${report.id} AND organization_id=${base.staff.organizationId}`);};
      let status=report.status;
      if(data.action==="verify"){
        const [doc]=((await tx.execute(sql`SELECT id FROM report_documents WHERE report_id=${report.id} AND organization_id=${base.staff.organizationId} AND scan_status='CLEAN' AND encryption_key_id IS NOT NULL ORDER BY uploaded_at DESC LIMIT 1`)) as unknown as {rows:Array<{id:string}>}).rows;
        if(!canVerifyReport({status:report.status as ReportStatus,scanStatus:doc?"CLEAN":null,uploaderId:report.uploader_staff_id,actorId:base.staff.staffUserId}))throw new Error("independent_clean_document_required");
        if(!canTransitionReport(report.status as ReportStatus,"VERIFIED"))throw new Error("report_transition_invalid");
        status="VERIFIED";await tx.execute(sql`UPDATE diagnostic_reports SET status=${status},verified_by_staff_id=${base.staff.staffUserId},updated_at=now() WHERE id=${report.id}`);await event("VERIFIED",data.reason,data.evidenceReference);
      }else if(data.action==="approve_release"){
        const [cleanDoc]=((await tx.execute(sql`SELECT id FROM report_documents WHERE report_id=${report.id} AND organization_id=${base.staff.organizationId} AND scan_status='CLEAN' AND encryption_key_id IS NOT NULL ORDER BY uploaded_at DESC LIMIT 1`)) as unknown as {rows:Array<{id:string}>}).rows;if(!cleanDoc)throw new Error("clean_scanned_document_required");
        if(!canApproveReportRelease({status:report.status as ReportStatus,verifiedBy:report.verified_by_staff_id,actorId:base.staff.staffUserId})||!canTransitionReport(report.status as ReportStatus,"APPROVED_FOR_RELEASE"))throw new Error("separate_release_approver_required");
        status="APPROVED_FOR_RELEASE";await tx.execute(sql`UPDATE diagnostic_reports SET status=${status},released_by_staff_id=${base.staff.staffUserId},updated_at=now() WHERE id=${report.id}`);await event("RELEASE_APPROVED",data.reason);
      }else if(data.action==="hold"||data.action==="clear_hold"){
        if(data.action==="hold"){if(["DELIVERED","SUPERSEDED"].includes(report.status))throw new Error("report_state_locked");status="ON_HOLD";await setPrivate({holdReason:data.reason});await tx.execute(sql`UPDATE diagnostic_reports SET status=${status},updated_at=now() WHERE id=${report.id}`);await event("HOLD_PLACED",data.reason);}
        else {if(report.status!=="ON_HOLD")throw new Error("report_not_on_hold");const [latest]=((await tx.execute(sql`SELECT scan_status,encryption_key_id FROM report_documents WHERE report_id=${report.id} AND organization_id=${base.staff.organizationId} ORDER BY uploaded_at DESC LIMIT 1`)) as unknown as {rows:Array<{scan_status:string;encryption_key_id:string|null}>}).rows;status=latest?.scan_status==="CLEAN"&&latest.encryption_key_id?"PENDING_VERIFICATION":"QUARANTINED";await setPrivate({holdReason:null});await tx.execute(sql`UPDATE diagnostic_reports SET status=${status},updated_at=now() WHERE id=${report.id}`);await event("HOLD_CLEARED",data.reason);}
      }else if(data.action==="raise_exception"){
        if(["DELIVERED","SUPERSEDED","EXCEPTION"].includes(report.status))throw new Error("report_state_locked");
        if(report.status!=="ON_HOLD"){await setPrivate({holdReason:data.reason});await tx.execute(sql`UPDATE diagnostic_reports SET status='ON_HOLD',updated_at=now() WHERE id=${report.id}`);await event("HOLD_PLACED",data.reason);}
        status="EXCEPTION";await tx.execute(sql`UPDATE diagnostic_reports SET status=${status},updated_at=now() WHERE id=${report.id}`);await event("EXCEPTION_RECORDED",data.reason,data.evidenceReference);
      }else if(data.action==="resolve_exception"){
        if(report.status!=="EXCEPTION")throw new Error("report_not_in_exception");
        const [latest]=((await tx.execute(sql`SELECT scan_status,encryption_key_id FROM report_documents WHERE report_id=${report.id} AND organization_id=${base.staff.organizationId} ORDER BY uploaded_at DESC LIMIT 1`)) as unknown as {rows:Array<{scan_status:string;encryption_key_id:string|null}>}).rows;
        status=latest?.scan_status==="CLEAN"&&latest.encryption_key_id?"PENDING_VERIFICATION":"QUARANTINED";await setPrivate({holdReason:null});await tx.execute(sql`UPDATE diagnostic_reports SET status=${status},updated_at=now() WHERE id=${report.id}`);await event("HOLD_CLEARED",data.reason);
      }else if(data.action==="delivery"){
        if(!["APPROVED_FOR_RELEASE","DELIVERY_PENDING"].includes(report.status))throw new Error("report_not_released");
        const [cleanDoc]=((await tx.execute(sql`SELECT id FROM report_documents WHERE report_id=${report.id} AND organization_id=${base.staff.organizationId} AND scan_status='CLEAN' AND encryption_key_id IS NOT NULL ORDER BY uploaded_at DESC LIMIT 1`)) as unknown as {rows:Array<{id:string}>}).rows;if(!cleanDoc)throw new Error("clean_scanned_document_required");
        if(data.outcome==="ACKNOWLEDGED"&&!data.evidenceReference)throw new Error("delivery_evidence_required");
        const key=request.headers.get("idempotency-key");if(!id.safeParse(key).success)throw new Error("idempotency_key_required");
        const deliveryId=randomUUID();const deliveryPrivate=encryptFinanceReportPrivateData("report-delivery",{recipientLabel:data.recipientLabel,recipientVerificationReference:data.recipientVerificationReference,evidenceReference:data.evidenceReference??null},{organizationId:base.staff.organizationId,centreId:report.centre_id,recordId:deliveryId});await tx.execute(sql`INSERT INTO report_deliveries(id,organization_id,centre_id,report_id,channel,outcome,evidence_provided,private_data_ciphertext,idempotency_key,actor_staff_id) VALUES(${deliveryId},${base.staff.organizationId},${report.centre_id},${report.id},${data.channel},${data.outcome},${Boolean(data.evidenceReference)},${deliveryPrivate},${key},${base.staff.staffUserId})`);
        status=deliveryResultStatus(data.outcome);if(!canTransitionReport(report.status as ReportStatus,status as ReportStatus))throw new Error("report_transition_invalid");await tx.execute(sql`UPDATE diagnostic_reports SET status=${status},updated_at=now() WHERE id=${report.id}`);await event(data.outcome==="ACKNOWLEDGED"?"DELIVERED":"DELIVERY_ATTEMPTED","Manual staff delivery record",data.evidenceReference);
      }else if(data.action==="supersede"){
        if(!["DELIVERED","APPROVED_FOR_RELEASE"].includes(report.status))throw new Error("only_released_report_can_be_corrected");
        const nextId=randomUUID(),nextNumber=`RHC-R-${new Date().getFullYear()}-${nextId.slice(0,8).toUpperCase()}`;
        await tx.execute(sql`UPDATE diagnostic_reports SET status='SUPERSEDED',updated_at=now() WHERE id=${report.id}`);
        const correctionPrivate=privatePayload({externalReference:data.externalReference??null,holdReason:null},base.staff.organizationId,report.centre_id,nextId);await tx.execute(sql`INSERT INTO diagnostic_reports(id,organization_id,centre_id,patient_id,order_id,report_number,private_data_ciphertext,source,status,version_number,supersedes_report_id,uploader_staff_id) VALUES(${nextId},${base.staff.organizationId},${report.centre_id},${report.patient_id},${report.order_id},${nextNumber},${correctionPrivate},${data.externalReference?"METROPOLIS_REFERENCE":"MANUAL"},'AWAITING_REPORT',${report.version_number+1},${report.id},${base.staff.staffUserId})`);
        await event("SUPERSEDED",data.reason);const correctedEventId=randomUUID();const correctedPrivate=encryptFinanceReportPrivateData("report-event",{reason:data.reason,evidenceReference:null},{organizationId:base.staff.organizationId,centreId:report.centre_id,recordId:correctedEventId});await tx.execute(sql`INSERT INTO report_events(id,organization_id,centre_id,report_id,event_type,private_data_ciphertext,actor_staff_id) VALUES(${correctedEventId},${base.staff.organizationId},${report.centre_id},${nextId},'CORRECTED',${correctedPrivate},${base.staff.staffUserId})`);status="SUPERSEDED";
        await appendAuditEvent(tx,{organizationId:base.staff.organizationId,centreId:report.centre_id,actorStaffId:base.staff.staffUserId,action:"report.corrected",entityType:"diagnostic_report",entityId:nextId,details:{version:report.version_number+1}});return {id:nextId,reportNumber:nextNumber,status};
      }
      await appendAuditEvent(tx,{organizationId:base.staff.organizationId,centreId:report.centre_id,actorStaffId:base.staff.staffUserId,action:`report.${data.action}`,entityType:"diagnostic_report",entityId:report.id,details:{status}});
      return {id:report.id,status};
    });
    return Response.json({report:result},{status:(data.action==="register"||data.action==="supersede")&&!("replayed" in result&&result.replayed)?201:200,headers:{"cache-control":"private, no-store"}});
  }catch(error){const code=error instanceof Error?error.message:"";const known=["forbidden","confirmed_order_required","not_found","independent_clean_document_required","clean_scanned_document_required","separate_release_approver_required","report_state_locked","report_not_on_hold","report_not_released","report_not_in_exception","delivery_evidence_required","idempotency_key_required","only_released_report_can_be_corrected","report_transition_invalid"];
    if(code==="forbidden")return Response.json({error:code},{status:403});if(code==="not_found")return Response.json({error:code},{status:404});if(known.includes(code))return Response.json({error:code},{status:409});return Response.json({error:"report_operation_unavailable"},{status:409});}
}
