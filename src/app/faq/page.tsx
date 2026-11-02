import { Suspense } from "react";
import Link from "next/link";
import { PageTitle } from "@/components/ui/page-title";
import { PublicFaq } from "@/components/website/public-faq";
import { getPublishedWebsiteContent, getPublishedWebsiteMetadata } from "@/server/public-website-content";
import type { PublicFaqItem } from "@/lib/public-faq";

export async function generateMetadata() {
  return getPublishedWebsiteMetadata("faq", { title: "Frequently asked questions" });
}

const defaultQuestions: PublicFaqItem[] = [
  { question: "Are listed prices current?", answer: "The public catalogue shows only an explicitly published, source-verified price whose effective dates include today. Rudra home-collection charges, if applicable, are separate.", topic: "Services" },
  { question: "Does this site confirm an appointment?", answer: "No. Online booking is not active. A service listing or visit to the booking page does not create or confirm an appointment.", topic: "Booking" },
  { question: "Can I view a report or patient record here?", answer: "Patient accounts and patient-facing report delivery are not active on this site. Staff access uses separate protected sign-in.", topic: "Privacy" },
  { question: "Does a family relationship give another person access to a report?", answer: "No. Family relationships do not grant medical-record access. Access requires a separate verified authorization.", topic: "Privacy" },
  { question: "How do I confirm collection coverage or preparation?", answer: "Check published service information, then confirm centre-specific availability and instructions directly with Rudra before acting. This site does not determine clinical preparation or specimen handling requirements.", topic: "Home collection" },
];

export function FaqContent({ items }: { items: PublicFaqItem[] }) {
  return <div className="inner-page"><div className="page-container">
    <PageTitle eyebrow="Helpful information" title="Frequently asked questions" description="What the public catalogue and booking information can and cannot confirm today." />
    <section className="admin-card" aria-labelledby="faq-service-guide-title">
      <h2 id="faq-service-guide-title">Need a guided next step?</h2>
      <p>Use the Rudra service guide for fixed-choice help with the verified catalogue, visit requests and contacting the team. It is not an AI or medical-advice service.</p>
      <Link className="button-link" href="/chat">Open Rudra service guide</Link>
    </section>
    <PublicFaq items={items} />
  </div></div>;
}

async function PublishedFaq() {
  const content = await getPublishedWebsiteContent("faq");
  const items: PublicFaqItem[] = content?.sections.map((section) => ({
    question: section.heading,
    answer: section.body,
    topic: "Published information",
  })) ?? defaultQuestions;
  return <FaqContent items={items} />;
}

export default function FaqPage() {
  return <Suspense fallback={<FaqContent items={defaultQuestions} />}><PublishedFaq /></Suspense>;
}
