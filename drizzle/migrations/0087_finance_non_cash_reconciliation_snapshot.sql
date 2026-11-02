ALTER TABLE finance_reconciliations
  ADD COLUMN non_cash_summary jsonb;

COMMENT ON COLUMN finance_reconciliations.non_cash_summary IS
  'Snapshot of non-cash payment ledger records at cash-session close; not external settlement verification.';
