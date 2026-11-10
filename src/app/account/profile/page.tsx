import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";
export const metadata = { title: "Patient profile | Rudra", robots: { index: false, follow: false } };
export default function PatientProfilePage() { return <PatientPortalPreview view="profile"/>; }
