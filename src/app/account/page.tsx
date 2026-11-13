import type { Metadata } from "next";
import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";

export const metadata: Metadata = { title: "Patient home | Rudra", robots: { index: false, follow: false } };

export default function AccountPage() {
  return <PatientPortalPreview view="dashboard" />;
}
