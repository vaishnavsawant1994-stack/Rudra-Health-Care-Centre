import { ReferencePagesPreview } from "../reference-pages";
import Link from "next/link";

export default function ReferenceDesignPages() {
  return <><ReferencePagesPreview/><nav className="reference-next-page"><Link href="/design-preview/support-portal">More references: Contact · FAQ · Health Info · Portal</Link></nav></>;
}
