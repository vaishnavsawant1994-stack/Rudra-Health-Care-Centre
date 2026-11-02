import { notFound } from "next/navigation";
import { PublicContentPage } from "@/components/website/public-content-page";
import { parsePublicContentSlug, publicContentSlugs } from "@/server/website-content";
import type { Metadata } from "next";

export function generateStaticParams() { return publicContentSlugs.map((slug) => ({ slug })); }
export const metadata: Metadata = { title: "Rudra Health Care Centre | Information" };
export default async function InformationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!parsePublicContentSlug(slug)) notFound();
  return <PublicContentPage slug={slug} />;
}
