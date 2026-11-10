import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Synthetic Booking Design Preview",
  description: "Local-only visual preview with synthetic examples; no patient, booking, payment or service records are created.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function DesignPreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
