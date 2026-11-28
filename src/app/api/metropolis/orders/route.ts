import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { diagnosticOrders } from "@/db/schema";
import { getApiAccess } from "@/server/access";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!z.uuid().safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await getApiAccess("samples.external.verify", centreId!);
  if (access.response) return access.response;
  const rows = await getDb().select({ id: diagnosticOrders.id, centreId: diagnosticOrders.centreId, orderNumber: diagnosticOrders.orderNumber, status: diagnosticOrders.status, createdAt: diagnosticOrders.createdAt }).from(diagnosticOrders).where(and(eq(diagnosticOrders.organizationId, access.staff.organizationId), eq(diagnosticOrders.centreId, centreId!), ne(diagnosticOrders.status, "CANCELLED"))).orderBy(asc(diagnosticOrders.createdAt)).limit(200);
  return Response.json({ orders: rows }, { headers: { "cache-control": "private, no-store" } });
}
