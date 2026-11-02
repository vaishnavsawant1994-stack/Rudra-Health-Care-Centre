import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { diagnosticOrders, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = z.object({ patientId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const patientAccess = await getApiAccess("patients.read");
  if (patientAccess.response) return patientAccess.response;
  const db = getDb();
  const [patient] = await db.select({ id: patients.id, centreId: patients.centreId, organizationId: patients.organizationId }).from(patients).where(and(eq(patients.id, parsed.data.patientId), eq(patients.organizationId, patientAccess.staff.organizationId))).limit(1);
  if (!patient) return Response.json({ error: "not_found" }, { status: 404 });
  const orderAccess = await getApiAccess("orders.read", patient.centreId);
  if (orderAccess.response) return Response.json({ error: "not_found" }, { status: 404 });
  const orders = await db.select({ id: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, status: diagnosticOrders.status, totalAmount: diagnosticOrders.totalAmount, currency: diagnosticOrders.currency, createdAt: diagnosticOrders.createdAt }).from(diagnosticOrders).where(and(eq(diagnosticOrders.patientId, patient.id), eq(diagnosticOrders.organizationId, patient.organizationId), eq(diagnosticOrders.centreId, patient.centreId))).orderBy(desc(diagnosticOrders.createdAt)).limit(100);
  return Response.json({ orders });
}
