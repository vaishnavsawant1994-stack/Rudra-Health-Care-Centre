import { AdminShell } from "@/components/admin/admin-shell";
import { ReferralAttributionReport } from "@/components/relationships/referral-attribution-report";
import type { PermissionGrant } from "@/server/permissions";

type ReferralType = "DOCTOR" | "CORPORATE" | "PARTNER";
function scopeFor(grants: PermissionGrant[], permission: string): string[] | null {
  const matching = grants.filter((grant) => grant.key === permission);
  if (!matching.length) return [];
  return matching.some((grant) => grant.centreId === null) ? null : [...new Set(matching.flatMap((grant) => grant.centreId ? [grant.centreId] : []))];
}
function commonScope(left: string[] | null, right: string[] | null): string[] | null {
  if (left === null) return right;
  if (right === null) return left;
  const rightSet = new Set(right);
  return left.filter((centreId) => rightSet.has(centreId));
}

export default function ReferralAttributionPage() {
  return <AdminShell permission="leads.read" title="Referral attribution">{(staff) => {
    const leadScope = scopeFor(staff.grants, "leads.read");
    const scopes: Record<ReferralType, string[] | null> = {
      DOCTOR: commonScope(leadScope, scopeFor(staff.grants, "doctors.read")),
      CORPORATE: commonScope(leadScope, scopeFor(staff.grants, "corporate.read")),
      PARTNER: commonScope(leadScope, scopeFor(staff.grants, "partners.read")),
    };
    return <ReferralAttributionReport scopes={scopes} />;
  }}</AdminShell>;
}
