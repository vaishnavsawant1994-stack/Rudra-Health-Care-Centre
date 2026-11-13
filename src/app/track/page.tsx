import { redirect } from "next/navigation";

/** W014's canonical URL forwards to the existing, privacy-safe tracking entry. */
export default function TrackPage(): never {
  redirect("/track-booking");
}
