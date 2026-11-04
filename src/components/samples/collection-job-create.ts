import type { IdempotencyAttempt } from "@/lib/idempotency-attempt";

export type CollectionJobCreateResult =
  | { kind: "saved"; body: Record<string, unknown>; replayed: boolean }
  | { kind: "rejected"; body: Record<string, unknown>; status: number }
  | { kind: "unconfirmed" };

/** Keep the same key when a network failure leaves the server outcome unknown. */
export async function submitCollectionJob(
  payload: { appointmentId: string; orderId: string },
  attempt: IdempotencyAttempt,
  fetcher: typeof fetch = fetch,
): Promise<CollectionJobCreateResult> {
  const body = JSON.stringify(payload);
  try {
    const idempotencyKey = await attempt.keyFor(body);
    const response = await fetcher("/api/collections", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body,
    });
    const result: Record<string, unknown> = await response.json().catch(() => ({}));
    if (response.ok) {
      attempt.clear();
      return { kind: "saved", body: result, replayed: (result.job as { replayed?: unknown } | undefined)?.replayed === true };
    }
    if (response.status < 500) attempt.clear();
    return { kind: "rejected", body: result, status: response.status };
  } catch {
    return { kind: "unconfirmed" };
  }
}
