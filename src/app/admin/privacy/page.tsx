import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function AdminPrivacyPage() {
  return <AdminShell permission="configuration.read" title="Consent and privacy console"><Phase10Restricted screen="S004" title="Privacy requests and retention operations are restricted" reason="Patient consent, family access and marketing consent are separate existing records, but this codebase has no consolidated privacy request, lawful export, erasure or retention-execution workflow. This console does not expose patient records or claim a request was completed." dependencies={["Approved privacy notice, retention schedule and legal basis", "Authenticated request intake, identity/authority verification and case ownership", "Audited export/deletion workflow with data minimization and completion evidence"]} /></AdminShell>;
}
