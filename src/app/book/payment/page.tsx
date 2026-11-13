import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Online Payment Unavailable | Rudra Health Care Centre", robots: { index: false, follow: false } };

export default function PaymentPage() {
  return <RudraBookingFlow step="payment" />;
}
