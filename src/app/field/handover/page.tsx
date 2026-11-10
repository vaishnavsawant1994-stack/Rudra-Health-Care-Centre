import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";
import { FieldWorkflowNav } from "@/components/samples/field-workflow-nav";

export default function FieldHandoverPage() {
  return <AdminShell permission="collections.visit.record" title="My collected specimens">
    {(staff) => <>
      <FieldWorkflowNav current="F011"/><p className="setup-notice">This list is limited to specimens linked to your assigned collection jobs. It shows operational handover status only; Rudra receiving staff must record physical receipt separately.</p>
      <SamplesDirectory mode="handover" grants={staff.grants} />
    </>}
  </AdminShell>;
}
