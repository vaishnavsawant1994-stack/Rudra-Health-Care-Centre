import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { FamilyOverview } from "@/components/families/family-workbench";

export const instant = false;
export default async function FamilyPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="families.read" title="Family 360°"><p className="setup-notice"><Link href="/families">Back to family directory</Link></p><FamilyOverview familyId={id} /></AdminShell>; }
