export type CentreOperationsQueueItem = { id: string; kind: string; title: string; reference: string; status: string; at: string; href: string };
export type CentreOperationsSummary = {
  id: string;
  code: string;
  name: string;
  timeZone: string;
  metrics: Record<string, number | undefined>;
  queue: CentreOperationsQueueItem[];
  omittedByKind?: Record<string, number>;
};

export async function loadCentreOperationsSummary(signal?: AbortSignal): Promise<CentreOperationsSummary[]> {
  const response = await fetch("/api/branch/operations", { cache: "no-store", signal });
  if (!response.ok) throw new Error("summary_unavailable");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("centres" in payload) || !Array.isArray(payload.centres)) {
    throw new Error("summary_invalid_response");
  }
  return payload.centres as CentreOperationsSummary[];
}
