import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Book Your Test or Package" };

export default function BookingPage() {
  return <RudraBookingFlow step="select" />;
}
