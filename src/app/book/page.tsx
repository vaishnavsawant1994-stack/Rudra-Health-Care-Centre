import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Request a Test or Package | Rudra Health Care Centre" };

export default function BookingPage() {
  return <RudraBookingFlow step="select" />;
}
