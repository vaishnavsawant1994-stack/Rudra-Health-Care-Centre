import { AdminShell } from "@/components/admin/admin-shell";
import { RelationshipPipeline } from "@/components/relationships/relationship-pipeline";
export default function RelationshipPipelinePage() { return <AdminShell permission="leads.read" title="Relationships and B2B pipeline">{staff => <RelationshipPipeline grants={staff.grants} />}</AdminShell>; }
