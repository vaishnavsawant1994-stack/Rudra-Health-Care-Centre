import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authUser } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import { PageTitle } from "@/components/ui/page-title";
import { TotpEnrollment } from "@/components/auth/totp-enrollment";
import { getAuth } from "@/lib/auth";
import { staffUsers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Suspense } from "react";

export const metadata = { title: "Authenticator setup" };

async function SecuritySetupContent() {
  const auth = getAuth();
  if (!auth) redirect("/staff");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/staff");
  const db = getDb();
  const [identity] = await db.select({ twoFactorEnabled: authUser.twoFactorEnabled }).from(authUser).where(eq(authUser.id, session.user.id)).limit(1);
  const [staff] = await db.select({ status: staffUsers.status }).from(staffUsers).where(eq(staffUsers.authUserId, session.user.id)).limit(1);
  if (!staff || (staff.status !== "ACTIVE" && staff.status !== "INVITED")) redirect("/staff");
  if (identity?.twoFactorEnabled) redirect("/staff/workspace");

  return <main className="inner-page"><div className="page-container"><PageTitle eyebrow="Required account security" title="Secure your Rudra account" description="Enrollment is required before this account can use owner or staff tools." /><TotpEnrollment /></div></main>;
}

export default function SecuritySetupPage() {
  return <Suspense fallback={<main className="inner-page"><div className="page-container"><p role="status">Checking account security…</p></div></main>}><SecuritySetupContent /></Suspense>;
}
