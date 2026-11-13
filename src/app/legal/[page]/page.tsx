import { notFound } from "next/navigation";
import { LegalPolicyPage } from "@/components/public/rudra-content-pages";

export const metadata = {
  title: "Legal and privacy information | Rudra Health Care Centre",
  robots: { index: false, follow: false },
};

const legalPages = new Set(["privacy", "terms", "consent", "medical-disclaimer", "billing-refunds", "accessibility"]);

export function generateStaticParams() {
  return [...legalPages].map((page) => ({ page }));
}

export default async function PublicLegalPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!legalPages.has(page)) notFound();
  return <LegalPolicyPage slug={page} />;
}
