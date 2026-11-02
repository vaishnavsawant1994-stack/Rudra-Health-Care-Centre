import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { FamilyCreateForm } from "@/components/families/family-workbench";

export default function NewFamilyPage() { return <AdminShell permission="families.create" title="Create family"><p className="setup-notice"><Link href="/families">Back to family directory</Link></p><FamilyCreateForm /></AdminShell>; }
