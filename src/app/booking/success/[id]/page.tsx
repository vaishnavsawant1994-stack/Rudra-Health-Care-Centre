import { Suspense } from "react";
import { PublicEnquiryReceipt } from "@/components/public/public-enquiry-receipt";

export const metadata = { title: "Enquiry Receipt | Rudra Health Care Centre", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default function BookingSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl p-8" aria-live="polite">Loading enquiry receipt…</main>}>
      <ReceiptFromParams params={params} />
    </Suspense>
  );
}

async function ReceiptFromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicEnquiryReceipt receiptId={id} />;
}
