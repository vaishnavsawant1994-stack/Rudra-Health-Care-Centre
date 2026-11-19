export type LatestRequestSequence = { current: number };

export function beginLatestRequest(sequence: LatestRequestSequence): number {
  sequence.current += 1;
  return sequence.current;
}

export function isLatestRequest(sequence: LatestRequestSequence, requestId: number): boolean {
  return sequence.current === requestId;
}

export function invalidateLatestRequest(sequence: LatestRequestSequence): void {
  sequence.current += 1;
}
