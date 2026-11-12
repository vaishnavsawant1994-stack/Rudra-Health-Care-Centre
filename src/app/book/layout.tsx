import type { ReactNode } from "react";
import { BookingDraftProvider } from "@/components/public/rudra-booking-flow";

export default function BookingLayout({ children }: { children: ReactNode }) {
  return <BookingDraftProvider>{children}</BookingDraftProvider>;
}
