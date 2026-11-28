"use client";

import { useCallback, useEffect, useState } from "react";
import type { PermissionGrant } from "@/server/permissions";

type Order = {
  id: string;
  orderNumber: string;
  centreId: string;
  totalAmount: string;
  currency: string;
};

type FinanceResponse = {
  orders: Order[];
  charges: Array<{ orderId: string }>;
};

type LoadState = "loading" | "ready" | "error";

async function readFinanceOrder(orderId: string, signal?: AbortSignal): Promise<FinanceResponse> {
  const response = await fetch(`/api/finance?orderId=${encodeURIComponent(orderId)}`, {
    cache: "no-store",
    signal,
  });
  const result = (await response.json()) as FinanceResponse & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Finance details are unavailable.");
  return result;
}

export function OrderBillingSnapshot({
  orderId,
  grants,
}: {
  orderId: string;
  grants: PermissionGrant[];
}) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadedOrderId, setLoadedOrderId] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [hasCharge, setHasCharge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("Loading billing details…");

  useEffect(() => {
    const controller = new AbortController();

    void readFinanceOrder(orderId, controller.signal)
      .then((result) => {
        const matchingOrder = result.orders.find((candidate) => candidate.id === orderId) ?? null;
        setOrder(matchingOrder);
        setHasCharge(result.charges.some((charge) => charge.orderId === orderId));
        setLoadedOrderId(orderId);
        setLoadState("ready");
        setMessage(matchingOrder ? "Billing details loaded." : "Confirmed order was not found in your authorized centre scope.");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadedOrderId(orderId);
        setLoadState("error");
        setMessage(error instanceof Error ? error.message : "Finance details are unavailable.");
      });

    return () => controller.abort();
  }, [orderId, retry]);

  const canCreateCharge = order !== null && grants.some(
    (grant) => grant.key === "finance.charge.create" && (grant.centreId === null || grant.centreId === order.centreId),
  );
  const visibleMessage = loadedOrderId === null || loadedOrderId === orderId ? message : "Loading billing details…";

  const createCharge = useCallback(async () => {
    if (!order || !canCreateCharge || busy) return;
    setBusy(true);
    setMessage("Creating an internal charge snapshot…");
    let created = false;
    try {
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ action: "create_order_charges", orderId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to create the internal charge snapshot.");
      created = true;
      const refreshed = await readFinanceOrder(orderId);
      setOrder(refreshed.orders.find((candidate) => candidate.id === orderId) ?? null);
      setHasCharge(refreshed.charges.some((charge) => charge.orderId === orderId));
      setMessage("Internal charge snapshot created. No legal invoice was issued.");
    } catch (error) {
      setMessage(created
        ? "Charge snapshot was created, but the refresh failed. Retry to reload the saved record."
        : error instanceof Error ? error.message : "Unable to create the internal charge snapshot.");
    } finally {
      setBusy(false);
    }
  }, [busy, canCreateCharge, order, orderId]);

  return (
    <section className="admin-card" aria-labelledby="order-billing-heading">
      <h2 id="order-billing-heading">Order billing snapshot</h2>
      <p role="status" aria-live="polite">{visibleMessage}</p>
      {loadState === "error" && loadedOrderId === orderId && (
        <button className="button" type="button" onClick={() => { setLoadState("loading"); setMessage("Loading billing details…"); setRetry((value) => value + 1); }}>
          Retry loading billing details
        </button>
      )}
      {loadState === "ready" && loadedOrderId === orderId && order && (
        <>
          <dl className="lead-details">
            <div><dt>Order</dt><dd>{order.orderNumber}</dd></div>
            <div><dt>Centre</dt><dd>{order.centreId}</dd></div>
            <div><dt>Confirmed diagnostic total</dt><dd>₹{order.totalAmount} {order.currency}</dd></div>
            <div><dt>Invoice issuer</dt><dd>Pending determination</dd></div>
            <div><dt>Legal invoice</dt><dd>Disabled pending policy approval</dd></div>
            <div><dt>Internal charge snapshot</dt><dd>{hasCharge ? "Recorded" : "Not recorded"}</dd></div>
          </dl>
          {!hasCharge && canCreateCharge && (
            <button className="button button-primary" type="button" disabled={busy} onClick={() => void createCharge()}>
              {busy ? "Creating charge snapshot…" : "Create internal charge snapshot"}
            </button>
          )}
          {!hasCharge && !canCreateCharge && (
            <p role="note">You have read access, but charge creation requires finance charge permission for this centre.</p>
          )}
        </>
      )}
    </section>
  );
}
