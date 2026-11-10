import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Booking Design Preview" };

export default function ConfirmationPage() {
  return <RudraBookingFlow step="confirmation" />;
}
