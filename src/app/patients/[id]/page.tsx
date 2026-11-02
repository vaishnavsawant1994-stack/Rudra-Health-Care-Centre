import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { PatientAppointmentLink, PatientProfile } from "@/components/patients/patient-workbench";
import { FinancePatientHistory } from "@/components/finance/finance-workbench";
import { ReportLinkedHistory } from "@/components/reports/report-linked-history";

export const instant = false;

export default async function PatientDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="patients.read" title="Patient 360°">{(staff) => <><p className="setup-notice"><Link href="/patients">Back to patient list</Link></p>{staff.grants.some((grant) => grant.key === "appointments.create") ? <p className="page-actions"><PatientAppointmentLink patientId={id} /></p> : null}<PatientProfile patientId={id} canReadOrders={staff.grants.some((grant) => grant.key === "orders.read")} canCreateOrder={staff.grants.some((grant) => grant.key === "orders.create")} canReadSamples={staff.grants.some((grant) => grant.key === "samples.read")} />{staff.grants.some((grant)=>grant.key==="reports.read")?<ReportLinkedHistory kind="patient" recordId={id}/>:null}{staff.grants.some((grant) => grant.key === "finance.read") ? <FinancePatientHistory patientId={id}/> : null}</>}</AdminShell>;
}
