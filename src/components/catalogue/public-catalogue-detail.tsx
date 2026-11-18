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
  type LoadState = { key: string; status: "loading" | "unavailable" | "unpublished" | "ready" };
  const requestKey = `${serviceType}:${id}`;
  const [itemState, setItemState] = useState<{ key: string; item: ServiceDetail } | null>(null);
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const currentState = loadState?.key === requestKey ? loadState.status : "loading";
  const item = itemState?.key === requestKey ? itemState.item : null;
  const loading = currentState === "loading";
  const retryable = currentState === "unavailable";
  const message = currentState === "loading"
    ? "Loading verified service details…"
    : currentState === "unavailable"
      ? "The catalogue is temporarily unavailable. Try again."
      : currentState === "unpublished"
        ? "This service is not currently published with a verified, effective price."
        : "";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/public/catalogue/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (!response.ok || body.item?.serviceType !== serviceType) {
          setItemState(null);
          setLoadState({ key: requestKey, status: response.status === 503 ? "unavailable" : "unpublished" });
          return;
        }
        setItemState({ key: requestKey, item: body.item as ServiceDetail });
        setLoadState({ key: requestKey, status: "ready" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setItemState(null);
        setLoadState({ key: requestKey, status: "unavailable" });
      });
    return () => controller.abort();
  }, [attempt, id, requestKey, serviceType]);

  if (!item) return <section className="public-catalogue-detail" aria-live="polite" aria-busy={loading}>
    <p role="status">{message}</p>
    {retryable && <button className="button button-primary" type="button" onClick={() => { setLoadState({ key: requestKey, status: "loading" }); setAttempt((current) => current + 1); }} disabled={loading}>Retry details</button>}
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
