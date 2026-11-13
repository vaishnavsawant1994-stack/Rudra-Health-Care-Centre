import { notFound } from "next/navigation";
import { PreventiveCheckupsArticle } from "@/components/public/rudra-content-pages";

export const metadata = {
  title: "Preventive checkups: questions to discuss | Rudra Health Care Centre",
  description: "General educational information about preventive screening conversations. Not medical advice or an individual test recommendation.",
};

export function generateStaticParams() {
  return [{ slug: "preventive-checkups" }];
}

export default async function HealthGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug !== "preventive-checkups") notFound();
  return <PreventiveCheckupsArticle />;
}
