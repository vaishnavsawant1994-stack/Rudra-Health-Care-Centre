import { AdminShell } from "@/components/admin/admin-shell";
import { AppointmentDetail } from "@/components/appointments/appointment-workbench";
import { AppointmentCollectionHistory } from "@/components/samples/sample-workbench";
import { FinanceRelatedHistory } from "@/components/finance/finance-workbench";
import { ReportLinkedHistory } from "@/components/reports/report-linked-history";

export const instant = false;

export default async function AppointmentDetailsPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="appointments.read" title="Appointment details">{(staff) => <><AppointmentDetail id={id} canCreateOrder={staff.grants.some((grant) => grant.key === "orders.create")} />{staff.grants.some((grant) => grant.key === "samples.read") ? <AppointmentCollectionHistory appointmentId={id} /> : null}{staff.grants.some((grant)=>grant.key==="reports.read")?<ReportLinkedHistory kind="appointment" recordId={id}/>:null}{staff.grants.some((grant)=>grant.key==="finance.read")?<FinanceRelatedHistory kind="appointment" id={id}/>:null}</>}</AdminShell>; }
