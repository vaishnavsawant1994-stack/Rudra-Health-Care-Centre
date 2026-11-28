import type { Metadata } from "next";
import StaffPage from "../page";

export const metadata: Metadata = { title: "Staff login | Rudra Health OS", robots: { index: false, follow: false } };

export default function StaffLoginPage() {
  return <StaffPage />;
}
