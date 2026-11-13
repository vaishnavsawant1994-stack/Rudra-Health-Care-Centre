import type { Metadata } from "next";
import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";

export const metadata: Metadata = { title: "Comparable health trends | Rudra", robots: { index: false, follow: false } };
export default function PatientHealthTrendsPage() { return <PatientPortalPreview view="trends" />; }
