import { AdminShell } from "@/components/admin/admin-shell";
import { AdminOperationForm } from "@/components/admin/admin-operation-form";
import { StaffDirectory } from "@/components/admin/staff-directory";

export default function AdminUsersPage() {
  return <AdminShell permission="staff.read" title="Users and staff directory">{(staff) => <>
    <p className="admin-card">S002 · Staff records are organization-scoped. Provisioning requires an organization-level staff.manage grant; accounts must enroll TOTP before protected access.</p>
    <StaffDirectory />
    {staff.grants.some((grant) => grant.key === "staff.manage" && grant.centreId === null) ? <section className="admin-card"><h2>Provision staff account</h2><p>Use a private channel for initial credentials. Public registration is disabled.</p><AdminOperationForm endpoint="/api/admin/staff" fields={[{ name: "displayName", label: "Staff display name", required: true }, { name: "email", label: "Work email", type: "email", required: true, placeholder: "staff@example.org" }, { name: "password", label: "Initial password (12–128 characters)", type: "password", required: true, minLength: 12, maxLength: 128 }]} submitLabel="Create invited account" /></section> : null}
  </>}</AdminShell>;
}
