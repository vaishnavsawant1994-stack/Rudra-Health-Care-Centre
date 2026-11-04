import { sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { csrfRejected,isSameOriginRequest } from "@/server/csrf";
import { decryptFinanceReportPrivateData } from "@/server/finance-report-crypto";

const schema=z.object({kind:z.enum(["patient","order","appointment"]),recordId:z.uuid()});
export async function POST(request:Request){
  if(!isSameOriginRequest(request))return csrfRejected();const data=schema.safeParse(await request.json().catch(()=>null));if(!data.success)return Response.json({error:"invalid_reference"},{status:400});
  const permission=data.data.kind==="patient"?"patients.read":data.data.kind==="order"?"orders.read":"appointments.read";const base=await getApiAccess(permission);if(base.response)return base.response;const db=getDb();
  let scope:{centre_id:string}|undefined;
  if(data.data.kind==="patient")scope=(await db.execute(sql`SELECT centre_id FROM patients WHERE id=${data.data.recordId} AND organization_id=${base.staff.organizationId}`) as unknown as {rows:Array<{centre_id:string}>}).rows[0];
  if(data.data.kind==="order")scope=(await db.execute(sql`SELECT centre_id FROM diagnostic_orders WHERE id=${data.data.recordId} AND organization_id=${base.staff.organizationId}`) as unknown as {rows:Array<{centre_id:string}>}).rows[0];
  if(data.data.kind==="appointment")scope=(await db.execute(sql`SELECT centre_id FROM appointments WHERE id=${data.data.recordId} AND organization_id=${base.staff.organizationId}`) as unknown as {rows:Array<{centre_id:string}>}).rows[0];
  if(!scope)return Response.json({error:"not_found"},{status:404});const access=await getApiAccess("reports.read",scope.centre_id);if(access.response)return access.response;
  const extra=data.data.kind==="patient"?sql`r.patient_id=${data.data.recordId}`:data.data.kind==="order"?sql`r.order_id=${data.data.recordId}`:sql`r.order_id IN(SELECT id FROM diagnostic_orders WHERE appointment_id=${data.data.recordId} AND organization_id=${base.staff.organizationId} AND centre_id=${scope.centre_id})`;
  const result=await db.execute(sql`SELECT r.id,r.organization_id AS "organizationId",r.centre_id AS "centreId",r.private_data_ciphertext AS "privateDataCiphertext",r.report_number AS "reportNumber",r.status,r.version_number AS "versionNumber",r.created_at AS "createdAt" FROM diagnostic_reports r WHERE r.organization_id=${base.staff.organizationId} AND r.centre_id=${scope.centre_id} AND ${extra} ORDER BY r.created_at DESC`);
  const reports=(result as unknown as {rows:Array<Record<string,unknown>&{id:string;organizationId:string;centreId:string;privateDataCiphertext:string}>}).rows.map(({privateDataCiphertext,...row})=>({...row,externalReference:decryptFinanceReportPrivateData<{externalReference:string|null}>("report-private",privateDataCiphertext,{organizationId:row.organizationId,centreId:row.centreId,recordId:row.id}).externalReference}));
  return Response.json({reports},{headers:{"cache-control":"private, no-store"}});
}
