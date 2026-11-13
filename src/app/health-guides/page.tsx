import { HealthInformationHub } from "@/components/public/rudra-content-pages";

export const metadata = {
  title: "Health guides | Rudra Health Care Centre",
  description: "General health and diagnostic service information for discussion with a qualified healthcare professional.",
  robots: { index: false, follow: false },
};

export default function HealthGuidesPage() {
  return <><p className="rc-info-notice" role="status"><b>Clinical review pending.</b> These general education pages are not a substitute for medical advice and are not promoted as approved clinical guidance.</p><HealthInformationHub /></>;
}
