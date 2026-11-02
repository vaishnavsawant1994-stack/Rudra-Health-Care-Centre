import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { appointments, leads } from "@/db/schema";

const LEAD_PAGE_SIZE = 50;
const APPOINTMENT_PAGE_SIZE = 25;
const query = z.object({ centreId: z.uuid(), page: z.coerce.number().int().min(1).max(10000).default(1), appointmentPage: z.coerce.number().int().min(1).max(10000).default(1) });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await context.params).id);
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!id.success || !parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const doctorAccess = await getApiAccess("doctors.read", parsed.data.centreId);
  if (doctorAccess.response) return doctorAccess.response;
  const leadAccess = await getApiAccess("leads.read", parsed.data.centreId);
  if (leadAccess.response) return leadAccess.response;
  if (doctorAccess.staff.organizationId !== leadAccess.staff.organizationId) return Response.json({ error: "not_found" }, { status: 404 });
  const db = getDb();
  const doctorResult = await db.execute(sql`SELECT id FROM doctor_profiles WHERE id = ${id.data} AND organization_id = ${doctorAccess.staff.organizationId} AND centre_id = ${parsed.data.centreId}`);
  const doctor = (doctorResult as unknown as { rows: Array<{ id: string }> }).rows[0];
  if (!doctor) return Response.json({ error: "not_found" }, { status: 404 });
  const attributedRows = await db.select({ id: leads.id, leadNumber: leads.leadNumber, status: leads.status, enquiryCategory: leads.enquiryCategory, createdAt: leads.createdAt })
    .from(leads)
    .where(and(eq(leads.organizationId, leadAccess.staff.organizationId), eq(leads.centreId, parsed.data.centreId), eq(leads.sourceDoctorId, id.data)))
    .orderBy(asc(leads.createdAt), asc(leads.id)).limit(LEAD_PAGE_SIZE + 1).offset((parsed.data.page - 1) * LEAD_PAGE_SIZE);
  const appointmentAccess = await getApiAccess("appointments.read", parsed.data.centreId);
  let appointmentActivity: { appointments: Array<{ id: string; appointmentNumber: string; leadNumber: string; status: string; scheduledAt: Date; visitType: string }>; appointmentPage: number; appointmentPageSize: number; appointmentsHaveMore: boolean } | undefined;
  if (!appointmentAccess.response && appointmentAccess.staff.organizationId === leadAccess.staff.organizationId) {
    const appointmentRows = await db.select({ id: appointments.id, appointmentNumber: appointments.appointmentNumber, leadNumber: leads.leadNumber, status: appointments.status, scheduledAt: appointments.scheduledAt, visitType: appointments.visitType })
      .from(appointments)
      .innerJoin(leads, and(eq(leads.id, appointments.leadId), eq(leads.organizationId, appointments.organizationId), eq(leads.centreId, appointments.centreId)))
      .where(and(eq(appointments.organizationId, leadAccess.staff.organizationId), eq(appointments.centreId, parsed.data.centreId), eq(leads.sourceDoctorId, id.data)))
      .orderBy(desc(appointments.scheduledAt), desc(appointments.id)).limit(APPOINTMENT_PAGE_SIZE + 1).offset((parsed.data.appointmentPage - 1) * APPOINTMENT_PAGE_SIZE);
    appointmentActivity = { appointments: appointmentRows.slice(0, APPOINTMENT_PAGE_SIZE), appointmentPage: parsed.data.appointmentPage, appointmentPageSize: APPOINTMENT_PAGE_SIZE, appointmentsHaveMore: appointmentRows.length > APPOINTMENT_PAGE_SIZE };
  }
  return Response.json({ leads: attributedRows.slice(0, LEAD_PAGE_SIZE), page: parsed.data.page, pageSize: LEAD_PAGE_SIZE, hasMore: attributedRows.length > LEAD_PAGE_SIZE, ...(appointmentActivity ?? {}), privacy: "CONTACT_DETAILS_OMITTED" });
}
