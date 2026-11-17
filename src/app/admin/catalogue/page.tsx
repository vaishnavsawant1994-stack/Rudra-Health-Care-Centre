import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { CataloguePriceReview } from "@/components/catalogue/catalogue-workbench";

export default function AdminCataloguePage() {
  return <AdminShell permission="catalogue.price.verify" title="Catalogue pricing and promotions governance"><>
    <p className="admin-card">S008 · Diagnostic catalogue prices retain their source and verification state. Home-collection charges are a separate Rudra service fee.</p>
    <CataloguePriceReview />
    <section className="admin-card"><h2>Promotion governance</h2><p>Promotion approval, eligibility and effective-date publication are not implemented in this route. No unapproved offer is published.</p><p><Link href="/catalogue/tests">Open diagnostic catalogue</Link> · <Link href="/catalogue/import">Review catalogue import</Link></p></section>
  </></AdminShell>;
}
