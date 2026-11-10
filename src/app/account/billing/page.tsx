import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";
export const metadata = { title: "Bills and payment history | Rudra", robots: { index: false, follow: false } };
export default function PatientBillingPage() { return <PatientPortalPreview view="billing"/>; }
