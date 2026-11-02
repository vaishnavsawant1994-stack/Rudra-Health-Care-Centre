import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { LeadCreateForm } from "@/components/leads/lead-workbench";

export default function NewLeadPage() { return <AdminShell permission="leads.create" title="New lead"><p className="setup-notice"><Link href="/leads">Back to leads</Link></p><LeadCreateForm /></AdminShell>; }
