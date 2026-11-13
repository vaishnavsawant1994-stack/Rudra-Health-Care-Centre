import type { Metadata } from "next";
import { PatientPortalPreview } from "@/components/patient/patient-portal-preview";

export const metadata: Metadata = { title: "Order care journey | Rudra", robots: { index: false, follow: false } };
export default function PatientOrderJourneyTimelinePage() { return <PatientPortalPreview view="journey" />; }
