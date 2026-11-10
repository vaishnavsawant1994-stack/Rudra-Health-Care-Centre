import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Review Your Booking" };

export default function ReviewPage() {
  return <RudraBookingFlow step="review" />;
}
