import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function QualityIncidentsPage() {
  return <AdminShell permission="tasks.support.read" title="Quality incidents and corrective action"><Phase10Restricted screen="O008" title="Incident/CAPA records are not implemented" reason="The current database has operational tasks and support requests, but no quality incident, investigation, evidence or corrective/preventive action record. A task is not treated as an incident." dependencies={["Incident and CAPA schema with immutable event history", "Severity, ownership, evidence and closure policy", "Independent reviewer and clinical protocol controls where applicable"]} /></AdminShell>;
}
