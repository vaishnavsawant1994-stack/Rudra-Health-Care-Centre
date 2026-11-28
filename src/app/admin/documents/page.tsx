import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function AdminDocumentsPage() {
  return <AdminShell permission="configuration.read" title="Document templates and legal issuers"><Phase10Restricted screen="S009" title="Legal issuer and official template changes are restricted" reason="The repository has operational report/document workflows, but it has no governed legal-issuer registry or approved invoice issuer/tax/settlement policy. Communication templates are not legal documents. This screen does not issue invoices or official reports." dependencies={["Owner/legal approval of issuer, tax, settlement and franchise responsibilities", "Versioned legal template and issuer records with separation of duties", "Document-specific authorization, audit and publication tests"]} /></AdminShell>;
}
