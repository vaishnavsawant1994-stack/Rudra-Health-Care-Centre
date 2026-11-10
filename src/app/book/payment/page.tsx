import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Payment Preview" };

export default function PaymentPage() {
  return <RudraBookingFlow step="payment" />;
}
