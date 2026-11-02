import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { FamilySharingPanel } from "@/components/families/family-workbench";

export const instant = false;
export default async function FamilySharingPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="families.sharing.manage" title="Family sharing permissions"><p className="setup-notice"><Link href={`/families/${id}`}>Back to Family 360°</Link></p><FamilySharingPanel familyId={id} /></AdminShell>; }
