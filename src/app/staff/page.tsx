import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "@/components/ui/page-title";
import { EmptyState } from "@/components/ui/empty-state";
import { StaffLoginAction } from "@/components/auth/staff-login-action";
import { SetupRequired } from "@/components/admin/setup-required";
import { getSetupStatus } from "@/lib/phase-one-config";
import { checkDatabase } from "@/db/client";
import { getAccess } from "@/server/access";
import Link from "next/link";

export const metadata: Metadata = { title: "Staff sign in" };

export default function StaffPage() {
  const setup = getSetupStatus();
  return <div className="inner-page"><PageTitle eyebrow="Owner and team access" title="Rudra team sign in" description="Rudra accounts are provisioned by an authorized owner, use secure passwords, and require authenticator-app verification before protected access." /><Suspense fallback={<EmptyState title="Checking staff access">Loading secure sign-in status.</EmptyState>}><StaffAccessState ready={setup.ready} missing={setup.missing} invalid={setup.invalid} /></Suspense></div>;
}

async function StaffAccessState({ ready, missing, invalid }: { ready: boolean; missing: string[]; invalid: string[] }) {
  const database = await checkDatabase();
  const access = ready ? await getAccess() : null;
  return <>
    {!ready ? <SetupRequired missing={missing} invalid={invalid} /> : !database.available ? <EmptyState title="PostgreSQL is not reachable">Sign-in stays unavailable until the configured database accepts a connection. No login was attempted.</EmptyState> : access?.kind === "allowed" ? <EmptyState title={`Signed in as ${access.staff.displayName}`}>Your account is active. Open the staff workspace to continue.</EmptyState> : access?.kind === "mfa-setup-required" ? <EmptyState title="Authenticator setup required">Set up and verify your authenticator before accessing Rudra tools. <Link className="text-link" href="/staff/security-setup">Continue MFA setup →</Link></EmptyState> : <><div className="notice"><span className="notice-icon" aria-hidden="true">⛨</span><div><h2>Protected Rudra account</h2><p>Only owner-provisioned accounts can sign in. Authenticator verification is required before owner or staff tools become available.</p></div></div><div className="page-actions"><StaffLoginAction enabled={ready && database.available} /></div></>}
    {access?.kind === "allowed" ? <div className="page-actions"><Link className="button button-primary" href="/staff/workspace">Open staff workspace <span aria-hidden="true">→</span></Link></div> : null}
  </>;
}
