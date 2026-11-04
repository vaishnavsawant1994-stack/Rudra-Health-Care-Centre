import { z } from "zod";
import { sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";

export async function POST(request:Request){
  if(!isSameOriginRequest(request))return csrfRejected();
  const input=z.object({orderId:z.uuid()}).safeParse(await request.json().catch(()=>null));
  if(!input.success)return Response.json({error:"invalid_reference"},{status:400});
  const base=await getApiAccess("finance.read");if(base.response)return base.response;
  const [order]=((await getDb().execute(sql`SELECT centre_id FROM diagnostic_orders WHERE id=${input.data.orderId} AND organization_id=${base.staff.organizationId}`)) as unknown as {rows:Array<{centre_id:string}>}).rows;
  if(!order)return Response.json({error:"not_found"},{status:404});
  const scoped=await getApiAccess("finance.read",order.centre_id);if(scoped.response)return scoped.response;
  const result=await getDb().execute(sql`SELECT c.id,c.charge_type AS "chargeType",c.charge_code AS "chargeCode",(c.amount_minor+COALESCE((SELECT sum(ad.amount_minor) FROM finance_adjustments ad WHERE ad.charge_id=c.id AND ad.organization_id=c.organization_id),0))::text AS "amountMinor",c.currency,c.state,c.created_at AS "createdAt",COALESCE(sum(CASE WHEN p.status IN ('CONFIRMED','PARTIALLY_REFUNDED','REFUNDED') THEN a.amount_minor-CASE WHEN p.amount_minor>0 THEN (a.amount_minor::numeric*COALESCE((SELECT sum(f.amount_minor) FROM finance_refunds f WHERE f.payment_id=p.id AND f.organization_id=p.organization_id AND f.status='EXECUTION_RECORDED'),0)/p.amount_minor)::bigint ELSE 0 END ELSE 0 END),0)::text AS "allocatedMinor" FROM finance_charges c LEFT JOIN finance_allocations a ON a.charge_id=c.id AND a.organization_id=c.organization_id LEFT JOIN finance_payments p ON p.id=a.payment_id AND p.organization_id=a.organization_id WHERE c.organization_id=${base.staff.organizationId} AND c.centre_id=${order.centre_id} AND c.order_id=${input.data.orderId} GROUP BY c.id ORDER BY c.created_at DESC`);
  return Response.json({charges:(result as unknown as {rows:unknown[]}).rows},{headers:{"cache-control":"private, no-store"}});
}
