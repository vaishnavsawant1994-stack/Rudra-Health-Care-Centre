import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";
export const metadata = { title: "Orders and sample history | Rudra", robots: { index: false, follow: false } };
export default function PatientOrdersPage() { return <PatientPortalPreview view="orders"/>; }
