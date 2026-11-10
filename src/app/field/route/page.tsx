import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { FieldRouteBoard } from "@/components/samples/field-route-board";
import { FieldWorkflowNav } from "@/components/samples/field-workflow-nav";

export default function FieldRoutePage() {
  return <AdminShell permission="collections.read" title="My visit route">{(staff) => staff.grants.some((grant) => grant.key === "collections.visit.record") ? <>
    <FieldWorkflowNav current="F005-F006"/><p className="setup-notice">Only visits assigned to your staff account are requested. Centre and session permissions are still checked by the API.</p>
    <FieldRouteBoard />
    <p><Link href="/field/today">Return to my collection assignments</Link></p>
  </> : <section className="admin-card"><h2>Access denied</h2><p>Your role cannot view field visit assignments.</p></section>}</AdminShell>;
}
