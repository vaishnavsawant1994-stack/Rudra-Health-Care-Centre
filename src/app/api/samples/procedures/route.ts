import { and, asc, eq, inArray } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, sampleProcedureApprovals } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { procedureSchema } from "@/server/sample-policy";

export async function GET() {
  const access = await getApiAccess("samples.read"); if (access.response) return access.response;
  const grants = access.staff.grants.filter((g) => g.key === "samples.read").map((g) => g.centreId);
  const filters = [eq(sampleProcedureApprovals.organizationId, access.staff.organizationId), eq(sampleProcedureApprovals.status, "ACTIVE")];
  if (!grants.includes(null)) filters.push(grants.length ? inArray(sampleProcedureApprovals.centreId, grants.filter((id): id is string => Boolean(id))) : eq(sampleProcedureApprovals.centreId, "00000000-0000-0000-0000-000000000000"));
  const rows = await getDb().select({ id: sampleProcedureApprovals.id, centreId: sampleProcedureApprovals.centreId, centreName: centres.name, operation: sampleProcedureApprovals.operation, reference: sampleProcedureApprovals.reference, approvedAt: sampleProcedureApprovals.approvedAt }).from(sampleProcedureApprovals).innerJoin(centres, and(eq(centres.id, sampleProcedureApprovals.centreId), eq(centres.organizationId, sampleProcedureApprovals.organizationId))).where(and(...filters)).orderBy(asc(sampleProcedureApprovals.operation));
  return Response.json({ procedures: rows.filter((row) => grants.includes(null) || grants.includes(row.centreId)) });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = procedureSchema.safeParse(body); if (!parsed.success) return Response.json({ error: "invalid_procedure_reference", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const base = await getApiAccess("samples.procedures.manage"); if (base.response) return base.response;
  const access = await getApiAccess("samples.procedures.manage", parsed.data.centreId); if (access.response) return access.response;
  try {
    const [row] = await getDb().insert(sampleProcedureApprovals).values({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, operation: parsed.data.operation, reference: parsed.data.reference, status: "ACTIVE", approvedByStaffId: access.staff.staffUserId }).returning({ id: sampleProcedureApprovals.id, operation: sampleProcedureApprovals.operation, reference: sampleProcedureApprovals.reference });
    await appendAuditEvent(getDb(), { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "sample_procedure.reference_approved", entityType: "sample_procedure", entityId: row.id, details: { operation: row.operation } });
    return Response.json({ procedure: row }, { status: 201 });
  } catch { return Response.json({ error: "procedure_reference_conflict" }, { status: 409 }); }
}
