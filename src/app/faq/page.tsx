import { Suspense } from "react";
import Link from "next/link";
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
  return <main className="ref-faq-page"><div className="ref-faq-hero"><div><span className="eyebrow">HELP CENTRE & FREQUENTLY ASKED QUESTIONS</span><h1>How can we help you?</h1><p>Find current answers about published services, visit requests, home collection and privacy.</p><p>The answers below describe what Rudra’s public website can confirm today.</p><div className="ref-faq-search-hint"><span aria-hidden="true">⌕</span><span>Search questions by service, booking or privacy topic below</span></div><div className="ref-faq-popular">Popular topics: <a href="#faq-answers">Booking</a><a href="#faq-answers">Home collection</a><a href="#faq-answers">Report access</a><a href="#faq-answers">Privacy</a></div></div><aside className="ref-faq-help"><h2>Need more help?</h2><p>Find a published centre or send a staff-reviewed enquiry.</p><Link href="/contact">Contact Rudra →</Link><Link href="/centres">View published centres →</Link><small>Phone, messaging and live chat appear only if published for a centre.</small></aside></div>
    <div className="ref-faq-topic-cards">{[["Booking & appointments", "Visit requests and changes"], ["Tests & packages", "Published catalogue information"], ["Home collection", "Request and coverage information"], ["Reports & privacy", "Patient access is not active"]].map(([title, copy]) => <a href="#faq-answers" key={title}><span aria-hidden="true">◇</span><strong>{title}</strong><small>{copy}</small></a>)}</div>
    <div className="ref-faq-content"><aside className="ref-faq-popular-list"><h2>Common questions</h2>{items.slice(0, 8).map((item) => <a key={item.question} href="#faq-answers">{item.question} <span>›</span></a>)}</aside><section className="ref-faq-answers" id="faq-answers"><div className="ref-contact-section-heading"><span className="eyebrow">HELP & INFORMATION</span><h2>All frequently asked questions</h2><p>Search questions or filter by topic.</p></div><PublicFaq items={items} /></section><aside className="ref-faq-guide"><h2>Rudra service guide</h2><p>Fixed-choice help for the verified catalogue and enquiry route. This is not an AI or medical-advice service.</p><Link className="button button-secondary" href="/chat">Open Rudra service guide</Link><p className="rp-disclaimer">Patient login and report delivery are not active.</p></aside></div>
  </main>;
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
