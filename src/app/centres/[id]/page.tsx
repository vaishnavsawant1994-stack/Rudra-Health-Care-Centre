import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PublicCentreDetails } from "@/components/centres/public-centre-details";
import { listPublicCentres } from "@/server/public-enquiry-centres";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return { title: "Centre details", robots: { index: false, follow: false } };
    const centres = await listPublicCentres();
    const centre = centres.find((item) => item.id === id);
    if (!centre) return { title: "Centre details", robots: { index: false, follow: false } };
    return { title: `${centre.name} | Rudra centre`, description: `Public location information and currently published diagnostic services for ${centre.name}. Listings do not reserve an appointment or confirm service availability.` };
  } catch {
    return { title: "Centre details", robots: { index: false, follow: false } };
  }
}

async function PublicCentrePageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <PublicCentreDetails centreId={id} />;
}

export default function PublicCentrePage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<main className="inner-page" role="status">Loading centre information…</main>}><PublicCentrePageContent params={params} /></Suspense>;
}
