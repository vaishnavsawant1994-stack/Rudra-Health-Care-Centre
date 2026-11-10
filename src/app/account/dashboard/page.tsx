import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";
export const metadata = { title: "Patient dashboard | Rudra", robots: { index: false, follow: false } };
export default function PatientDashboardPage() { return <PatientPortalPreview view="dashboard"/>; }
