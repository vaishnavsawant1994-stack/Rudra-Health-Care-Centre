import Link from "next/link";
import type { AccessResult } from "@/server/access";
import { SetupRequired } from "./setup-required";

export function AccessState({ access, title }: { access: Exclude<AccessResult, { kind: "allowed" }>; title: string }) {
  if (access.kind === "setup") return <SetupRequired title={title} missing={access.status.missing} invalid={access.status.invalid} />;
  if (access.kind === "signed-out") return <section className="empty-state"><span className="empty-icon" aria-hidden="true">⛨</span><div><h2>Staff sign-in required</h2><p>Sign in with your Rudra staff account to continue.</p><Link className="text-link" href="/staff">Go to staff sign in →</Link></div></section>;
  if (access.kind === "mfa-setup-required") return <section className="notice setup-notice"><span className="notice-icon" aria-hidden="true">⛨</span><div><h2>Authenticator setup required</h2><p>Set up and verify an authenticator app before accessing Rudra administration.</p><Link className="text-link" href="/staff/security-setup">Set up multi-factor authentication →</Link></div></section>;
  if (access.kind === "denied") return <section className="error-state" role="status"><strong>Access denied</strong><p>Your account is not active or does not have permission to view this page.</p></section>;
  return <section className="error-state" role="status"><strong>Secure service unavailable</strong><p>Access could not be verified. Try again after database and identity services are available.</p></section>;
}
