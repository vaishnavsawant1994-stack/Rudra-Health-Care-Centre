"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPublicBookingCatalogueHref } from "@/lib/public-booking-prefill";

type ServiceDetail = {
  id: string;
  centreId: string;
  centreName: string;
  serviceType: "TEST" | "PACKAGE";
  serviceCode: string;
  version: number;
  displayName: string;
  specimenRequirements: string | null;
  preparationInstructions: string | null;
  priceAmount: string;
  currency: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  includedTests: Array<{ id: string; serviceCode: string; displayName: string; specimenRequirements: string | null; preparationInstructions: string | null }>;
};

export function PublicCatalogueDetail({ id, serviceType }: { id: string; serviceType: "TEST" | "PACKAGE" }) {
  const [item, setItem] = useState<ServiceDetail | null>(null);
  const [state, setState] = useState("Loading verified service details…");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/public/catalogue/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!response.ok || body.item?.serviceType !== serviceType) {
          setItem(null);
          setState(response.status === 503 ? "The catalogue is temporarily unavailable. Try again later." : "This service is not currently published with a verified, effective price.");
          return;
        }
        setItem(body.item as ServiceDetail);
        setState("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setItem(null);
        setState("The catalogue is temporarily unavailable. Try again later.");
      });
    return () => controller.abort();
  }, [id, serviceType]);

  if (!item) return <section className="public-catalogue-detail" aria-live="polite">
    <p role="status">{state}</p>
    <Link className="button button-secondary" href={serviceType === "TEST" ? "/tests" : "/packages"}>Back to {serviceType === "TEST" ? "tests" : "packages"}</Link>
  </section>;

  return <article className="public-catalogue-detail">
    <p className="eyebrow">{serviceType === "TEST" ? "Diagnostic test" : "Diagnostic package"} · {item.serviceCode} · Catalogue version {item.version}</p>
    <h2>{item.displayName}</h2>
    <p>{item.centreName}</p>
    <p className="public-catalogue-price">{item.currency === "INR" ? "₹" : `${item.currency} `}{item.priceAmount}</p>
    <p>Verified catalogue price effective {item.effectiveFrom}{item.effectiveUntil ? ` through ${item.effectiveUntil}` : " until further notice"}.</p>
    {item.specimenRequirements && <section><h3>Specimen requirements</h3><p>{item.specimenRequirements}</p></section>}
    {item.preparationInstructions && <section><h3>Preparation</h3><p>{item.preparationInstructions}</p></section>}
    {serviceType === "PACKAGE" && <section><h3>Included tests</h3>{item.includedTests.length
      ? <ul>{item.includedTests.map((test) => <li key={test.id}><strong>{test.displayName}</strong> <span>({test.serviceCode})</span>{test.specimenRequirements && <p>Specimen: {test.specimenRequirements}</p>}{test.preparationInstructions && <p>Preparation: {test.preparationInstructions}</p>}</li>)}</ul>
      : <p>Included test details are not currently published for this package.</p>}</section>}
    <p className="public-catalogue-note">Price and service information are shown only while this catalogue version is published, verified and effective. Rudra home-collection charges, if applicable, are separate. This page does not confirm appointment availability or a laboratory order.</p>
    <div className="page-actions"><Link className="button button-secondary" href={serviceType === "TEST" ? "/tests" : "/packages"}>Back to directory</Link><Link className="button button-primary" href={getPublicBookingCatalogueHref({ centreId: item.centreId, itemId: item.id, version: item.version, serviceText: `${item.displayName} (${item.serviceCode})` })}>Request this service</Link></div>
  </article>;
}
