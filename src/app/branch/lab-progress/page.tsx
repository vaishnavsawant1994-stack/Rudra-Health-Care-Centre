import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { MetropolisWorkbench } from "@/components/samples/metropolis-workbench";

export default function PartnerLabProgressPage() { return <AdminShell permission="samples.read" title="Partner lab status review">{(staff) => <><SampleWorkflowNav current="L011"/><MetropolisWorkbench mode="progress" grants={staff.grants} staffId={staff.staffUserId}/></>}</AdminShell>; }
