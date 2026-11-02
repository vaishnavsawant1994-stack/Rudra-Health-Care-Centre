import type { Metadata } from "next";
import { GuidedPublicAssistant } from "@/components/public/guided-public-assistant";

export const metadata: Metadata = { title: "Service guide", description: "Find the right Rudra service information and next step.", robots: { index: false, follow: true } };

export default function ChatPage() {
  return <main className="inner-page"><div className="page-container"><GuidedPublicAssistant /></div></main>;
}
