import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/page-title";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
export const metadata: Metadata = { title: "Patient account", robots: { index: false, follow: false } };

export default function AccountPage() {
  return <div className="inner-page">
    <PageTitle eyebrow="Patient access" title="Your care, connected" description="Rudra patient accounts are planned as a private place to manage your own care and explicitly authorized family access." />
    <EmptyState title="Patient accounts are disabled">
      This page is informational only. There is no patient sign-in, registration, demo account or patient information here. Accounts will remain disabled until Rudra approves and implements an identity-proofing approach. A family relationship alone will never provide access to another person’s records.
    </EmptyState>
    <section className="account-preview-links" aria-label="Patient portal design previews"><h2>Patient portal design previews</h2><p>These screens show the planned layout only. No patient records or sample account data are available.</p><nav><Link href="/account/dashboard">Patient home</Link><Link href="/account/profile">My profile</Link><Link href="/account/family">Family dashboard</Link><Link href="/account/family/demo">Family member 360°</Link><Link href="/account/bookings">My bookings</Link><Link href="/account/orders">My orders</Link><Link href="/account/reports">My reports</Link><Link href="/account/billing">Payments and bills</Link><Link href="/account/addresses">Addresses</Link><Link href="/account/calendar">Health calendar</Link><Link href="/account/notifications">Notifications</Link><Link href="/account/support">Support requests</Link></nav></section>
  </div>;
}
