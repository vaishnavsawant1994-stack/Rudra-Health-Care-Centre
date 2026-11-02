-- Keep request replay lookups bounded for transactional appointment and
-- collection assignment mutations recorded in the append-only audit stream.
CREATE UNIQUE INDEX audit_events_mutation_idempotency_uq
  ON audit_events (organization_id, (details->>'mutationIdempotencyKey'))
  WHERE details ? 'mutationIdempotencyKey';
