import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected,isSameOriginRequest } from "@/server/csrf";
import { persistReportPdf,readReportPdf,removeReportPdf,safeReportStorageKey,scanReportBuffer } from "@/server/report-storage";
import { activeReportKeyId } from "@/server/report-crypto";
import { encryptFinanceReportPrivateData } from "@/server/finance-report-crypto";

type Context={params:Promise<{id:string}>};
const UUID=z.uuid();

export async function POST(request:Request,context:Context){
  if(!isSameOriginRequest(request))return csrfRejected();
  const key=request.headers.get("idempotency-key");if(!UUID.safeParse(key).success)return Response.json({error:"idempotency_key_required"},{status:400});
  const {id:reportId}=await context.params;if(!UUID.safeParse(reportId).success)return Response.json({error:"not_found"},{status:404});
  const base=await getApiAccess("reports.document.upload");if(base.response)return base.response;
  const db=getDb();const [report]=((await db.execute(sql`SELECT id,centre_id,status FROM diagnostic_reports WHERE id=${reportId} AND organization_id=${base.staff.organizationId}`)) as unknown as {rows:Array<{id:string;centre_id:string;status:string}>}).rows;
  if(!report)return Response.json({error:"not_found"},{status:404});const scoped=await getApiAccess("reports.document.upload",report.centre_id);if(scoped.response)return scoped.response;
  if(["DELIVERED","SUPERSEDED","ON_HOLD"].includes(report.status))return Response.json({error:"report_state_locked"},{status:409});
  const form=await request.formData().catch(()=>null);const file=form?.get("file");if(!(file instanceof File)||file.type!=="application/pdf"||file.size>10*1024*1024)return Response.json({error:"pdf_required_max_10mb"},{status:400});
  const bytes=Buffer.from(await file.arrayBuffer());const storageKey=safeReportStorageKey();let saved=false;
  try{
    const scan=await scanReportBuffer(bytes);if(scan.status==="REJECTED")return Response.json({error:"malware_detected_upload_rejected"},{status:422});await persistReportPdf(storageKey,bytes);saved=true;const sha256=createHash("sha256").update(bytes).digest("hex");const encryptionKeyId=activeReportKeyId();
    const filename="report.pdf";
    const result=await db.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${base.staff.organizationId}:report-upload:${key}`},0))`);
      const prior=((await tx.execute(sql`SELECT id,scan_status,centre_id FROM report_documents WHERE organization_id=${base.staff.organizationId} AND idempotency_key=${key}`)) as unknown as {rows:Array<{id:string;scan_status:string;centre_id:string}>}).rows[0];if(prior){const replayAccess=await getApiAccess("reports.document.upload",prior.centre_id);if(replayAccess.response)throw new Error("forbidden");return {id:prior.id,scanStatus:prior.scan_status,replayed:true};}
      const current=((await tx.execute(sql`SELECT status FROM diagnostic_reports WHERE id=${reportId} AND organization_id=${base.staff.organizationId} AND centre_id=${report.centre_id} FOR UPDATE`)) as unknown as {rows:Array<{status:string}>}).rows[0];if(!current||["DELIVERED","SUPERSEDED","ON_HOLD"].includes(current.status))throw new Error("report_state_locked");
      const docId=crypto.randomUUID();
      await tx.execute(sql`INSERT INTO report_documents(id,organization_id,centre_id,report_id,storage_key,original_filename,media_type,byte_size,sha256,scan_status,scan_engine,encryption_key_id,idempotency_key,uploaded_by_staff_id) VALUES(${docId},${base.staff.organizationId},${report.centre_id},${reportId},${storageKey},${filename},'application/pdf',${bytes.length},${sha256},${scan.status},${scan.engine},${encryptionKeyId},${key},${base.staff.staffUserId})`);
      const nextStatus=scan.status==="CLEAN"?"PENDING_VERIFICATION":"QUARANTINED";
      await tx.execute(sql`UPDATE diagnostic_reports SET status=${nextStatus},updated_at=now() WHERE id=${reportId}`);
      const eventId=crypto.randomUUID();const privateData=encryptFinanceReportPrivateData("report-event",{reason:scan.status==="CLEAN"?"Document scan completed":"Scanner unavailable; document quarantined",evidenceReference:null},{organizationId:base.staff.organizationId,centreId:report.centre_id,recordId:eventId});await tx.execute(sql`INSERT INTO report_events(id,organization_id,centre_id,report_id,event_type,private_data_ciphertext,idempotency_key,actor_staff_id) VALUES(${eventId},${base.staff.organizationId},${report.centre_id},${reportId},'DOCUMENT_UPLOADED',${privateData},${key},${base.staff.staffUserId})`);
      await appendAuditEvent(tx,{organizationId:base.staff.organizationId,centreId:report.centre_id,actorStaffId:base.staff.staffUserId,action:"report.document_uploaded",entityType:"diagnostic_report",entityId:reportId,details:{scanStatus:scan.status}});
      return {id:docId,scanStatus:scan.status,replayed:false};
    });
    if(result.replayed)await removeReportPdf(storageKey);
    return Response.json({document:result,message:result.scanStatus==="QUARANTINED"?"Stored privately in quarantine; no preview, verification or release is allowed until a trusted malware scanner reports clean.":undefined},{status:result.replayed?200:201});
  }catch(error){if(saved)await removeReportPdf(storageKey);const code=error instanceof Error?error.message:"";return Response.json({error:code==="forbidden"?code:code==="report_state_locked"?code:"document_upload_unavailable"},{status:code==="forbidden"?403:code==="report_state_locked"?409:503});}
}

export async function GET(request:Request,context:Context){
  const {id:reportId}=await context.params;if(!UUID.safeParse(reportId).success)return Response.json({error:"not_found"},{status:404});
  const base=await getApiAccess("reports.read");if(base.response)return base.response;
  const scopeResult=await getDb().execute(sql`SELECT centre_id,status FROM diagnostic_reports WHERE id=${reportId} AND organization_id=${base.staff.organizationId}`);
  const scope=(scopeResult as unknown as {rows:Array<{centre_id:string;status:string}>}).rows[0];if(!scope)return Response.json({error:"not_found"},{status:404});
  const required=scope.status==="PENDING_VERIFICATION"?"reports.verify":"reports.read";const access=await getApiAccess(required,scope.centre_id);if(access.response)return access.response;
  const result=await getDb().execute(sql`SELECT d.storage_key,d.scan_status,d.sha256,d.original_filename,d.centre_id,d.encryption_key_id FROM report_documents d WHERE d.report_id=${reportId} AND d.organization_id=${base.staff.organizationId} AND d.centre_id=${scope.centre_id} ORDER BY d.uploaded_at DESC LIMIT 1`);
  const row=(result as unknown as {rows:Array<{storage_key:string;scan_status:string;sha256:string;original_filename:string;centre_id:string;encryption_key_id:string|null}>}).rows[0];if(!row)return Response.json({error:"not_found"},{status:404});
  if(row.scan_status!=="CLEAN"||!row.encryption_key_id)return Response.json({error:"document_quarantined"},{status:423});
  try{const bytes=await readReportPdf(row.storage_key,row.encryption_key_id);const digest=createHash("sha256").update(bytes).digest("hex");if(digest!==row.sha256)return Response.json({error:"document_integrity_failed"},{status:503});
    await appendAuditEvent(getDb(),{organizationId:base.staff.organizationId,centreId:scope.centre_id,actorStaffId:base.staff.staffUserId,action:"report.document_accessed",entityType:"diagnostic_report",entityId:reportId,details:{accessType:"download"}});
    const inline=new URL(request.url).searchParams.get("inline")==="1";
    return new Response(bytes,{headers:{"content-type":"application/pdf","content-disposition":`${inline?"inline":"attachment"}; filename="${reportId}.pdf"`,"cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"sandbox","referrer-policy":"no-referrer","x-frame-options":"SAMEORIGIN"}});
  }catch{return Response.json({error:"document_unavailable"},{status:503});}
}
