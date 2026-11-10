import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";
export const metadata = { title: "My reports | Rudra", robots: { index: false, follow: false } };
export default function PatientReportsPage() { return <PatientPortalPreview view="reports"/>; }
