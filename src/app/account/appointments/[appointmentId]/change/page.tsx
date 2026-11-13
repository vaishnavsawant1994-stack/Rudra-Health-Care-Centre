import type { Metadata } from "next";
import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";

export const metadata: Metadata = { title: "Appointment change request | Rudra", robots: { index: false, follow: false } };
export default function PatientAppointmentChangePage() { return <PatientPortalPreview view="appointment-change" />; }
