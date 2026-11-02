import { redirect } from "next/navigation";

/** Canonical public partner enquiry content and form live at /partners. */
export default function PartnerEnquiryAliasPage(): never {
  redirect("/partners");
}
