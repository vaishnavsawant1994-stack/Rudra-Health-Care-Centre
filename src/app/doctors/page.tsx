import { BusinessServicesPage } from "@/components/public/business-services-page";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("doctors", { title: "Information for Doctors | Rudra Health Care Centre" }); }
export default function DoctorsInformationPage() { return <BusinessServicesPage kind="doctors"/>; }
