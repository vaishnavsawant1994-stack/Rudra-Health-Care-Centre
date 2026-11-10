import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";
export const metadata = { title: "Health calendar | Rudra", robots: { index: false, follow: false } };
export default function PatientCalendarPage() { return <PatientPortalPreview view="calendar"/>; }
