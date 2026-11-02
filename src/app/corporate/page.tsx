import { BusinessServicesPage } from "@/components/public/business-services-page";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("corporate", { title: "Corporate Diagnostic Services | Rudra Health Care Centre" }); }
export default function CorporateServicesPage() { return <BusinessServicesPage kind="corporate"/>; }
