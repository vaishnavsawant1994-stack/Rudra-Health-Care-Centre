import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { collectionJobs, collectionJobEvents, patients, sampleCustodyEvents, specimens } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, operationalContext } from "@/server/operational-crypto";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = z.object({ patientId: z.uuid() }).safeParse(body); if (!parsed.success) return Response.json({ error: "invalid_patient_id" }, { status: 400 });
  const base = await getApiAccess("patients.read"); if (base.response) return base.response;
  const db = getDb(); const [patient] = await db.select({ id: patients.id, organizationId: patients.organizationId, centreId: patients.centreId }).from(patients).where(and(eq(patients.id, parsed.data.patientId), eq(patients.organizationId, base.staff.organizationId))).limit(1);
  if (!patient) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("samples.read", patient.centreId); if (access.response) return access.response;
  const [jobRows, sampleRows] = await Promise.all([
    db.select({ id: collectionJobs.id, jobNumber: collectionJobs.jobNumber, appointmentId: collectionJobs.appointmentId, orderId: collectionJobs.orderId, status: collectionJobs.status, scheduledStart: collectionJobs.scheduledStart, createdAt: collectionJobs.createdAt }).from(collectionJobs).where(and(eq(collectionJobs.organizationId, patient.organizationId), eq(collectionJobs.centreId, patient.centreId), eq(collectionJobs.patientId, patient.id))).orderBy(asc(collectionJobs.scheduledStart)),
    db.select({ id: specimens.id,organizationId:specimens.organizationId,centreId:specimens.centreId,specimenNumber: specimens.specimenNumber,privateDataCiphertext:specimens.privateDataCiphertext, status: specimens.status, collectedAt: specimens.collectedAt, receivedAt: specimens.receivedAt }).from(specimens).where(and(eq(specimens.organizationId, patient.organizationId), eq(specimens.centreId, patient.centreId), eq(specimens.patientId, patient.id))).orderBy(asc(specimens.collectedAt)),
  ]);
  const jobIds = jobRows.map((job) => job.id);
  const jobEvents = jobIds.length ? await db.select({id:collectionJobEvents.id,organizationId:collectionJobEvents.organizationId,centreId:collectionJobEvents.centreId,jobId: collectionJobEvents.jobId, eventType: collectionJobEvents.eventType,privateDataCiphertext:collectionJobEvents.privateDataCiphertext, recordedAt: collectionJobEvents.recordedAt }).from(collectionJobEvents).where(and(eq(collectionJobEvents.organizationId, patient.organizationId), eq(collectionJobEvents.centreId, patient.centreId), inArray(collectionJobEvents.jobId, jobIds))).orderBy(asc(collectionJobEvents.recordedAt)) : [];
  const sampleIds = sampleRows.map((sample) => sample.id);
  const custody = sampleIds.length ? await db.select({id:sampleCustodyEvents.id,organizationId:sampleCustodyEvents.organizationId,centreId:sampleCustodyEvents.centreId,specimenId: sampleCustodyEvents.specimenId, eventType: sampleCustodyEvents.eventType, source: sampleCustodyEvents.source,privateDataCiphertext:sampleCustodyEvents.privateDataCiphertext, recordedAt: sampleCustodyEvents.recordedAt }).from(sampleCustodyEvents).where(and(eq(sampleCustodyEvents.organizationId, patient.organizationId), eq(sampleCustodyEvents.centreId, patient.centreId), inArray(sampleCustodyEvents.specimenId, sampleIds))).orderBy(asc(sampleCustodyEvents.recordedAt)) : [];
  const specimensOut=sampleRows.map(({privateDataCiphertext,...sample})=>({...sample,...decryptOperationalData<{specimenType:string;requirementReference:string}>(privateDataCiphertext,operationalContext({organizationId:sample.organizationId,centreId:sample.centreId,recordId:sample.id},"specimen"))}));
  const jobsOut=jobEvents.map(({privateDataCiphertext,...event})=>({...event,...decryptOperationalData<{reason:string;evidenceReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:event.organizationId,centreId:event.centreId,recordId:event.id},"collection-job-event"))}));
  const custodyOut=custody.map(({privateDataCiphertext,...event})=>({...event,...decryptOperationalData<{reason:string;evidenceReference:string|null}>(privateDataCiphertext,operationalContext({organizationId:event.organizationId,centreId:event.centreId,recordId:event.id},"sample-custody-event"))}));
  return Response.json({ jobs: jobRows, specimens: specimensOut, jobEvents:jobsOut, custodyEvents: custodyOut });
}
