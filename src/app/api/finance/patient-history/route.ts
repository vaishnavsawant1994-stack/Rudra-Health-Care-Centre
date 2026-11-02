import { z } from "zod";
import { sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { isSameOriginRequest, csrfRejected } from "@/server/csrf";

export async function POST(request:Request){
  if(!isSameOriginRequest(request))return csrfRejected();
  const input=z.object({patientId:z.uuid()}).safeParse(await request.json().catch(()=>null));if(!input.success)return Response.json({error:"invalid_patient_reference"},{status:400});
  const base=await getApiAccess("finance.read");if(base.response)return base.response;
  const [patient]=((await getDb().execute(sql`SELECT id,centre_id FROM patients WHERE id=${input.data.patientId} AND organization_id=${base.staff.organizationId}`)) as unknown as {rows:Array<{id:string;centre_id:string}>}).rows;
  if(!patient)return Response.json({error:"not_found"},{status:404});
  const access=await getApiAccess("finance.read",patient.centre_id);if(access.response)return access.response;
  const patientAccess=await getApiAccess("patients.read",patient.centre_id);if(patientAccess.response)return patientAccess.response;
  const result=await getDb().execute(sql`SELECT c.id,c.charge_type AS "chargeType",c.charge_code AS "chargeCode",(c.amount_minor+COALESCE((SELECT sum(ad.amount_minor) FROM finance_adjustments ad WHERE ad.charge_id=c.id AND ad.organization_id=c.organization_id),0))::text AS "amountMinor",c.currency,c.state,c.created_at AS "createdAt",c.order_id AS "orderId",COALESCE(sum(a.amount_minor-COALESCE((SELECT sum(f.amount_minor) FROM finance_refunds f WHERE f.payment_id=p.id AND f.organization_id=p.organization_id AND f.status='EXECUTION_RECORDED'),0)) FILTER(WHERE p.status IN ('CONFIRMED','PARTIALLY_REFUNDED','REFUNDED')),0)::text AS "allocatedMinor" FROM finance_charges c LEFT JOIN finance_allocations a ON a.charge_id=c.id AND a.organization_id=c.organization_id LEFT JOIN finance_payments p ON p.id=a.payment_id AND p.organization_id=a.organization_id WHERE c.organization_id=${base.staff.organizationId} AND c.centre_id=${patient.centre_id} AND (c.order_id IN (SELECT id FROM diagnostic_orders WHERE patient_id=${patient.id} AND organization_id=${base.staff.organizationId}) OR c.appointment_id IN (SELECT id FROM appointments WHERE patient_id=${patient.id} AND organization_id=${base.staff.organizationId})) GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`);
  return Response.json({charges:(result as unknown as {rows:unknown[]}).rows});
}
