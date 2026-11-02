"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PublicCatalogueSearchItem = {
  id: string;
  centreId: string;
  centreName: string;
  serviceType: "TEST" | "PACKAGE";
  displayName: string;
  priceAmount: string;
  currency: string;
};

type SearchResponse = { items?: PublicCatalogueSearchItem[]; page?: number; hasMore?: boolean; error?: string };

export function usePublicCatalogueSearch() {
  const [items, setItems] = useState<PublicCatalogueSearchItem[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const queryRef = useRef("");

  const reset = useCallback(() => {
    sequenceRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    queryRef.current = "";
    setItems([]);
    setMessage("");
    setBusy(false);
    setHasMore(false);
    setPage(0);
  }, []);

  useEffect(() => () => {
    sequenceRef.current += 1;
    requestRef.current?.abort();
  }, []);

  const load = useCallback(async (query: string, nextPage: number, append: boolean) => {
    const normalized = query.trim();
    if (normalized.length < 2 || busy) return;
    if (!append) queryRef.current = normalized;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++sequenceRef.current;
    setBusy(true);
    setMessage(append ? "Loading more verified services…" : "Searching the published, verified catalogue…");
    if (!append) {
      setItems([]);
      setHasMore(false);
      setPage(0);
    }
    try {
      const response = await fetch("/api/public/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: normalized, page: nextPage }),
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json() as SearchResponse;
      if (!response.ok) throw new Error(body.error ?? "service_search_unavailable");
      if (sequence !== sequenceRef.current) return;
      const nextItems = body.items ?? [];
      setItems((current) => {
        if (!append) return nextItems;
        const seen = new Set(current.map((item) => `${item.centreId}:${item.id}`));
        return [...current, ...nextItems.filter((item) => !seen.has(`${item.centreId}:${item.id}`))];
      });
      setPage(body.page ?? nextPage);
      setHasMore(body.hasMore === true);
      setMessage(nextItems.length
        ? append ? `Loaded ${nextItems.length} more verified catalogue match${nextItems.length === 1 ? "" : "es"}.` : `Found ${nextItems.length} verified catalogue match${nextItems.length === 1 ? "" : "es"}.${body.hasMore ? " More matches are available." : ""}`
        : append ? "No more verified catalogue matches are available." : "No matching service is currently published with verified catalogue information. Contact the Rudra team for help.");
    } catch {
      if (sequence !== sequenceRef.current || controller.signal.aborted) return;
      setMessage("The service catalogue is unavailable right now. Please contact the Rudra team.");
    } finally {
      if (sequence === sequenceRef.current && !controller.signal.aborted) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }, [busy]);

  const search = useCallback((query: string) => load(query, 1, false), [load]);
  const loadMore = useCallback(() => {
    if (queryRef.current && hasMore && !busy) void load(queryRef.current, page + 1, true);
  }, [busy, hasMore, load, page]);

  return { items, message, busy, hasMore, search, loadMore, reset };
}
