import { IdempotencyAttempt } from "@/lib/idempotency-attempt";

/** Keep one retry key per collection job without putting specimen details in browser storage. */
export function collectionSpecimenAttempt(jobId: string, attempts: Map<string, IdempotencyAttempt>) {
  const attemptId = `${jobId}:collect`;
  let attempt = attempts.get(attemptId);
  if (!attempt) {
    attempt = new IdempotencyAttempt(`rudra:sample-collection:${jobId}`);
    attempts.set(attemptId, attempt);
  }
  return { attemptId, attempt };
}
