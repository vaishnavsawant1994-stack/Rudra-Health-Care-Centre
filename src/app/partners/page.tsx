import { BusinessServicesPage } from "@/components/public/business-services-page";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("partners", { title: "Partner Enquiries | Rudra Health Care Centre" }); }
export default function PartnerInformationPage() { return <BusinessServicesPage kind="partners"/>; }
