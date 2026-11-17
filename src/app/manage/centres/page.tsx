import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDataPanel } from "@/components/admin/admin-data-panel";
import { AdminOperationForm } from "@/components/admin/admin-operation-form";
import { CentrePublicProfileWorkbench } from "@/components/admin/centre-public-profile-workbench";

export default function ManagedCentresPage() {
  return <AdminShell permission="centres.read" title="Multi-centre directory and settings">{(staff) => <>
    <p className="admin-card">O003 · Centre records are read through organization and centre authorization. Only an unscoped centres.manage grant can create a centre.</p>
    <AdminDataPanel endpoint="/api/admin/centres" label="Authorized centre directory" />
    {staff.grants.some((grant) => grant.key === "centres.manage") ? <CentrePublicProfileWorkbench /> : null}
    {staff.grants.some((grant) => grant.key === "centres.manage" && grant.centreId === null) ? <section className="admin-card"><h2>Add centre</h2><AdminOperationForm endpoint="/api/admin/centres" fields={[{ name: "code", label: "Centre code" }, { name: "name", label: "Centre name" }, { name: "timeZone", label: "Time zone", placeholder: "Asia/Kolkata", required: false }]} submitLabel="Create centre" /></section> : null}
  </>}</AdminShell>;
}
