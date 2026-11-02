import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { appointments, leads } from "@/db/schema";

const APPOINTMENT_PAGE_SIZE = 25;

export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const centreId = params.get("centreId");
  const page = Number(params.get("page") ?? "1");
  const appointmentPage = Number(params.get("appointmentPage") ?? "1");
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(centreId).success || !["CORPORATE", "PARTNER"].includes(type ?? "") || !Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(appointmentPage) || appointmentPage < 1 || appointmentPage > 10000) {
    return Response.json({ error: "invalid_relationship_leads_query" }, { status: 400 });
  }
  const scope = type === "CORPORATE" ? "corporate.read" : "partners.read";
  const relationshipAccess = await getApiAccess(scope, centreId!);
  if (relationshipAccess.response) return relationshipAccess.response;
  const leadAccess = await getApiAccess("leads.read", centreId!);
  if (leadAccess.response) return leadAccess.response;
  try {
    const rows = await getDb().select({ id: leads.id, leadNumber: leads.leadNumber, source: leads.source, status: leads.status, enquiryCategory: leads.enquiryCategory, createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.organizationId, leadAccess.staff.organizationId), eq(leads.centreId, centreId!), eq(leads.sourceRelationshipId, id), eq(leads.sourceRelationshipType, type!)))
      .orderBy(asc(leads.createdAt), asc(leads.id)).limit(51).offset((page - 1) * 50);
    const appointmentAccess = await getApiAccess("appointments.read", centreId!);
    let appointmentActivity: { appointments: Array<{ id: string; appointmentNumber: string; leadNumber: string; status: string; scheduledAt: Date; visitType: string }>; appointmentPage: number; appointmentPageSize: number; appointmentsHaveMore: boolean } | undefined;
    if (!appointmentAccess.response && appointmentAccess.staff.organizationId === leadAccess.staff.organizationId) {
      const appointmentRows = await getDb().select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, leadNumber: leads.leadNumber, status: appointments.status, scheduledAt: appointments.scheduledAt, visitType: appointments.visitType })
        .from(appointments)
        .innerJoin(leads, and(eq(leads.id, appointments.leadId), eq(leads.organizationId, appointments.organizationId), eq(leads.centreId, appointments.centreId)))
        .where(and(eq(appointments.organizationId, leadAccess.staff.organizationId), eq(appointments.centreId, centreId!), eq(leads.sourceRelationshipId, id), eq(leads.sourceRelationshipType, type!)))
        .orderBy(desc(appointments.scheduledAt), desc(appointments.id)).limit(APPOINTMENT_PAGE_SIZE + 1).offset((appointmentPage - 1) * APPOINTMENT_PAGE_SIZE);
      appointmentActivity = { appointments: appointmentRows.slice(0, APPOINTMENT_PAGE_SIZE), appointmentPage, appointmentPageSize: APPOINTMENT_PAGE_SIZE, appointmentsHaveMore: appointmentRows.length > APPOINTMENT_PAGE_SIZE };
    }
    return Response.json({ leads: rows.slice(0, 50), page, pageSize: 50, hasMore: rows.length > 50, ...(appointmentActivity ?? {}), privacy: "CONTACT_DETAILS_OMITTED" });
  } catch {
    return Response.json({ error: "relationship_leads_unavailable" }, { status: 503 });
  }
}
