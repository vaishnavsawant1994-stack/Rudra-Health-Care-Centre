import { RudraBookingFlow } from "@/components/public/rudra-booking-flow";

export const metadata = { title: "Review Your Visit Request | Rudra Health Care Centre" };

export default function ReviewPage() {
  return <RudraBookingFlow step="review" />;
}
