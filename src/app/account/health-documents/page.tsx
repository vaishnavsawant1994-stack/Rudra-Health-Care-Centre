import type { Metadata } from "next";
import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";

export const metadata: Metadata = { title: "Health document vault | Rudra", robots: { index: false, follow: false } };
export default function PatientHealthDocumentsPage() { return <PatientPortalPreview view="documents" />; }
