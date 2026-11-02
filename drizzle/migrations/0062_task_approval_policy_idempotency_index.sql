CREATE INDEX audit_events_task_policy_idempotency_idx
  ON audit_events (organization_id, (details->>'idempotencyKey'))
  WHERE entity_type = 'staff_approval_policy'
    AND action = 'staff_approval_policy.updated'
    AND details ? 'idempotencyKey';

COMMENT ON INDEX audit_events_task_policy_idempotency_idx IS
  'Supports organization-scoped replay lookup for idempotent task approval policy updates recorded in the append-only audit chain.';
