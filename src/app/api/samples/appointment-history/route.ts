import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointments, collectionJobs, collectionJobEvents, sampleCustodyEvents, specimens } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, operationalContext } from "@/server/operational-crypto";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = z.object({ appointmentId: z.uuid() }).safeParse(body); if (!parsed.success) return Response.json({ error: "invalid_appointment_id" }, { status: 400 });
  let base = await getApiAccess("appointments.read"); let assignedOnly = false;
  if (base.response) { base = await getApiAccess("appointments.assigned.read"); assignedOnly = true; }
  if (base.response) return base.response;
  const db = getDb(); const [appointment] = await db.select({ id: appointments.id, organizationId: appointments.organizationId, centreId: appointments.centreId, assignedStaffId: appointments.assignedStaffId }).from(appointments).where(and(eq(appointments.id, parsed.data.appointmentId), eq(appointments.organizationId, base.staff.organizationId))).limit(1);
  if (!appointment || (assignedOnly && appointment.assignedStaffId !== base.staff.staffUserId)) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("samples.read", appointment.centreId); if (access.response) return access.response;
  const [job] = await db.select({ id: collectionJobs.id, jobNumber: collectionJobs.jobNumber, status: collectionJobs.status, orderId: collectionJobs.orderId, scheduledStart: collectionJobs.scheduledStart, versionNumber: collectionJobs.versionNumber }).from(collectionJobs).where(and(eq(collectionJobs.appointmentId, appointment.id), eq(collectionJobs.organizationId, appointment.organizationId), eq(collectionJobs.centreId, appointment.centreId))).limit(1);
  if (!job) return Response.json({ job: null, specimens: [], jobEvents: [], custodyEvents: [] });
  if (job.id && assignedOnly) {
    const [assignedJob] = await db.select({ id: collectionJobs.id }).from(collectionJobs).where(and(eq(collectionJobs.id, job.id), eq(collectionJobs.assignedStaffId, base.staff.staffUserId))).limit(1);
    if (!assignedJob) return Response.json({ error: "not_found" }, { status: 404 });
  }
  const [samples, jobEvents] = await Promise.all([
    db.select({ id: specimens.id,organizationId:specimens.organizationId,centreId:specimens.centreId,specimenNumber: specimens.specimenNumber,privateDataCiphertext:specimens.privateDataCiphertext, status: specimens.status, collectedAt: specimens.collectedAt, receivedAt: specimens.receivedAt }).from(specimens).where(and(eq(specimens.jobId, job.id), eq(specimens.organizationId, appointment.organizationId))).orderBy(asc(specimens.collectedAt)),
    db.select({ id:collectionJobEvents.id,organizationId:collectionJobEvents.organizationId,centreId:collectionJobEvents.centreId,eventType: collectionJobEvents.eventType,privateDataCiphertext:collectionJobEvents.privateDataCiphertext, recordedAt: collectionJobEvents.recordedAt }).from(collectionJobEvents).where(and(eq(collectionJobEvents.jobId, job.id), eq(collectionJobEvents.organizationId, appointment.organizationId))).orderBy(asc(collectionJobEvents.recordedAt)),
  ]);
  const ids = samples.map((sample) => sample.id); const custodyEvents = ids.length ? await db.select({id:sampleCustodyEvents.id,organizationId:sampleCustodyEvents.organizationId,centreId:sampleCustodyEvents.centreId,specimenId: sampleCustodyEvents.specimenId, eventType: sampleCustodyEvents.eventType, source: sampleCustodyEvents.source,privateDataCiphertext:sampleCustodyEvents.privateDataCiphertext, recordedAt: sampleCustodyEvents.recordedAt }).from(sampleCustodyEvents).where(and(eq(sampleCustodyEvents.organizationId, appointment.organizationId), eq(sampleCustodyEvents.centreId, appointment.centreId), inArray(sampleCustodyEvents.specimenId, ids))).orderBy(asc(sampleCustodyEvents.recordedAt)) : [];
  const safeSamples=samples.map(({privateDataCiphertext,...sample})=>({...sample,...decryptOperationalData<{specimenType:string;requirementReference:string}>(privateDataCiphertext,operationalContext({organizationId:sample.organizationId,centreId:sample.centreId,recordId:sample.id},"specimen"))}));
  const safeJobs=jobEvents.map(({privateDataCiphertext,...event})=>({...event,...decryptOperationalData<{reason:string;evidenceReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:event.organizationId,centreId:event.centreId,recordId:event.id},"collection-job-event"))}));
  const safeCustody=custodyEvents.map(({privateDataCiphertext,...event})=>({...event,...decryptOperationalData<{reason:string;evidenceReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:event.organizationId,centreId:event.centreId,recordId:event.id},"sample-custody-event"))}));
  return Response.json({ job, specimens: safeSamples, jobEvents:safeJobs, custodyEvents:safeCustody });
}
