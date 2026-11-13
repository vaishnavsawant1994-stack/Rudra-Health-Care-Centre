import type { Metadata } from "next";
import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";

export const metadata: Metadata = { title: "My appointments | Rudra", robots: { index: false, follow: false } };
export default function PatientAppointmentsPage() { return <PatientPortalPreview view="appointments" />; }
