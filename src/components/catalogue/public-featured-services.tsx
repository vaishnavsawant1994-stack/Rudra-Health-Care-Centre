"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPublicBookingCatalogueHref } from "@/lib/public-booking-prefill";

type Item = { id: string; centreId: string; centreName: string; serviceType: "TEST" | "PACKAGE"; serviceCode: string; version: number; displayName: string; priceAmount: string; currency: string; effectiveFrom: string };

export function PublicFeaturedServices() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("Loading currently published services…");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/catalogue?page=1&pageSize=6", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error("catalogue unavailable");
        const next = Array.isArray(body.items) ? body.items as Item[] : [];
        setItems(next);
        setStatus(next.length ? "" : "No services are currently published with an effective verified price.");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setItems([]); setStatus("The service catalogue is temporarily unavailable. Please try again later.");
      });
    return () => controller.abort();
  }, [reloadKey]);

  return <div className="ref-featured-grid" aria-live="polite">
    {status && <p className="ref-inline-state" role="status">{status}</p>}
    {status.includes("temporarily unavailable") && <button className="button button-secondary" type="button" onClick={() => setReloadKey((current) => current + 1)}>Retry catalogue</button>}
    {items.map((item) => <article className="ref-service-card" key={item.id}>
      <div className="ref-service-image" aria-hidden="true"><span>{item.serviceType === "TEST" ? "⚗" : "✿"}</span></div>
      <div className="ref-service-body"><small>{item.serviceType === "TEST" ? "Diagnostic test" : "Diagnostic package"} · {item.serviceCode}</small><h3>{item.displayName}</h3><p>{item.centreName}</p><strong className="ref-price">{item.currency === "INR" ? "₹" : `${item.currency} `}{item.priceAmount}</strong><small>Verified catalogue price · effective {item.effectiveFrom}</small><div className="ref-actions"><Link className="button button-secondary" href={`/${item.serviceType === "TEST" ? "tests" : "packages"}/${encodeURIComponent(item.id)}`}>View details</Link><Link className="button button-primary" href={getPublicBookingCatalogueHref({ centreId: item.centreId, itemId: item.id, version: item.version, serviceText: `${item.displayName} (${item.serviceCode})` })}>Request this service</Link></div></div>
    </article>)}
  </div>;
}
