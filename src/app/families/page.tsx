import { AdminShell } from "@/components/admin/admin-shell";
import { FamilyDirectory } from "@/components/families/family-workbench";

export default function FamiliesPage() { return <AdminShell permission="families.read" title="Family directory"><FamilyDirectory /></AdminShell>; }
