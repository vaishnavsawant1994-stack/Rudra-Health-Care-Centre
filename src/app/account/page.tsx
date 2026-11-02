import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/page-title";
import { EmptyState } from "@/components/ui/empty-state";
export const metadata: Metadata = { title: "Patient account", robots: { index: false, follow: false } };

export default function AccountPage() {
  return <div className="inner-page">
    <PageTitle eyebrow="Patient access" title="Your care, connected" description="Rudra patient accounts are planned as a private place to manage your own care and explicitly authorized family access." />
    <EmptyState title="Patient accounts are disabled">
      This page is informational only. There is no patient sign-in, registration, demo account or patient information here. Accounts will remain disabled until Rudra approves and implements an identity-proofing approach. A family relationship alone will never provide access to another person’s records.
    </EmptyState>
  </div>;
}
