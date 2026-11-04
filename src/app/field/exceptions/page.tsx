import { AdminShell } from "@/components/admin/admin-shell";
import { FieldExceptionQueue } from "@/components/samples/field-exception-queue";

export default function FieldExceptionsPage() {
  return <AdminShell permission="collections.visit.record" title="My collection exceptions">
    {() => <><p className="setup-notice">Open exceptions are limited to collection jobs currently assigned to your staff account. Patient records and private exception notes require separate authorization.</p><FieldExceptionQueue /></>}
  </AdminShell>;
}
