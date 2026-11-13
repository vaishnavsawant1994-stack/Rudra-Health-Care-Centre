import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Enquiry Receipt | Rudra Health Care Centre", robots: { index: false, follow: false } };

export default function ConfirmationPage() {
  return <RudraBookingFlow step="confirmation" />;
}
