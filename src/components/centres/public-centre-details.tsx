"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { PageTitle } from "@/components/ui/page-title";
import { publicCentreServiceRequestHref } from "@/lib/public-centre-links";

type PublicCentre = { id: string; code: string; name: string; publicProfile: null | { address: string | null; phone: string | null; email: string | null; serviceArea: string | null; openingHours: string | null } };
type PublicService = { id: string; centreId: string; serviceType: "TEST" | "PACKAGE"; serviceCode: string; version: number; displayName: string; specimenRequirements: string | null; preparationInstructions: string | null; priceAmount: string; currency: string; effectiveFrom: string; effectiveUntil: string | null };
type ServiceResponse = { items?: PublicService[]; page?: number; hasMore?: boolean };

export function PublicCentreDetails({ centreId }: { centreId: string }) {
  const [centre, setCentre] = useState<PublicCentre | null>(null);
  const [services, setServices] = useState<PublicService[]>([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [serviceType, setServiceType] = useState<"" | "TEST" | "PACKAGE">("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState("Loading centre details…");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/centres", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json() as { centres?: PublicCentre[] } }))
      .then(({ response, body }) => {
        if (!response.ok || !Array.isArray(body.centres)) throw new Error("centre_unavailable");
        const matching = body.centres.find((item) => item.id === centreId);
        if (!matching) throw new Error("centre_unavailable");
        setCentre(matching);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("This centre is unavailable or has no published public profile.");
      });
    return () => controller.abort();
  }, [centreId]);

  useEffect(() => {
    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => { if (!controller.signal.aborted) setState("Loading published services…"); }, 0);
    const params = new URLSearchParams({ centreId, page: String(page), pageSize: "50" });
    if (appliedQuery) params.set("q", appliedQuery);
    if (serviceType) params.set("serviceType", serviceType);
    void fetch(`/api/public/catalogue?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json() as ServiceResponse }))
      .then(({ response, body }) => {
        window.clearTimeout(loadingTimer);
        if (!response.ok || !Array.isArray(body.items)) throw new Error("services_unavailable");
        setServices(body.items.filter((item) => item.centreId === centreId));
        setHasMore(body.hasMore === true);
        setState(body.items.length ? "" : "No published services match these filters.");
      })
      .catch((error: unknown) => {
        window.clearTimeout(loadingTimer);
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setServices([]);
          setHasMore(false);
          setState("Published services could not be loaded. Try again later.");
        }
      });
    return () => { controller.abort(); window.clearTimeout(loadingTimer); };
  }, [centreId, appliedQuery, serviceType, page]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  return <div className="inner-page public-centre-detail">
    <p className="eyebrow">Rudra centre</p>
    {centre ? <>
      <PageTitle eyebrow={centre.code} title={centre.name} description="Centre information and services currently published in Rudra’s verified diagnostic catalogue." />
      <section className="notice"><div><h2>Centre information</h2>
        {centre.publicProfile?.address && <p>{centre.publicProfile.address}</p>}
        {centre.publicProfile?.serviceArea && <p><strong>Service area:</strong> {centre.publicProfile.serviceArea}</p>}
        {centre.publicProfile?.openingHours && <p><strong>Published hours:</strong> {centre.publicProfile.openingHours}</p>}
        {centre.publicProfile?.phone && <p><strong>Phone:</strong> <a href={`tel:${encodeURIComponent(centre.publicProfile.phone)}`}>{centre.publicProfile.phone}</a></p>}
        {centre.publicProfile?.email && <p><strong>Email:</strong> <a href={`mailto:${encodeURIComponent(centre.publicProfile.email)}`}>{centre.publicProfile.email}</a></p>}
        {!centre.publicProfile && <p>Public address and contact details have not been published for this centre.</p>}
      </div></section>
      <section className="public-centre-services" aria-labelledby="public-centre-services-heading">
        <div className="section-heading"><div><span className="eyebrow">Verified public catalogue</span><h2 id="public-centre-services-heading">Services at this centre</h2></div><Link className="text-link" href={`/book?centreId=${encodeURIComponent(centre.id)}`}>Send a booking request</Link></div>
        <p className="public-catalogue-note">These listings are currently published and price-effective. A listing does not reserve a slot or confirm service availability. Home-collection charges, if applicable, are separate.</p>
        <form className="public-service-filters" onSubmit={search}>
          <label>Search services<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} placeholder="Service name or code" /></label>
          <label>Service type<select value={serviceType} onChange={(event) => { setServiceType(event.target.value as "" | "TEST" | "PACKAGE"); setPage(1); }}><option value="">Tests and packages</option><option value="TEST">Tests</option><option value="PACKAGE">Packages</option></select></label>
          <button className="button button-secondary" type="submit">Search</button>
        </form>
        {state && <p role="status">{state}</p>}
        {services.length > 0 && <ul className="public-service-list">{services.map((service) => <li key={service.id}>
          <div><span className="eyebrow">{service.serviceType === "TEST" ? "Diagnostic test" : "Diagnostic package"} · {service.serviceCode}</span><h3>{service.displayName}</h3>
            {service.specimenRequirements && <p><strong>Specimen information:</strong> {service.specimenRequirements}</p>}
            {service.preparationInstructions && <p><strong>Preparation information:</strong> {service.preparationInstructions}</p>}
            <p className="public-service-price"><strong>{service.currency === "INR" ? "₹" : `${service.currency} `}{service.priceAmount}</strong><small>Verified catalogue price · effective from {service.effectiveFrom}</small></p>
          </div>
          <div className="public-service-actions"><Link className="button button-secondary" href={service.serviceType === "TEST" ? `/tests/${encodeURIComponent(service.id)}` : `/packages/${encodeURIComponent(service.id)}`}>Service details</Link><Link className="button button-primary" href={publicCentreServiceRequestHref(centre.id, service)}>Ask about this service</Link></div>
        </li>)}</ul>}
        <nav className="task-pagination" aria-label="Published services pages"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>Next</button></nav>
      </section>
    </> : <section className="admin-card" role="status"><p>{state}</p><Link href="/centres">Return to centre directory</Link></section>}
  </div>;
}
