CREATE TRIGGER finance_charges_immutable BEFORE UPDATE OR DELETE ON finance_charges FOR EACH ROW EXECUTE FUNCTION finance_history_append_only();
COMMENT ON TRIGGER finance_charges_immutable ON finance_charges IS 'Charge snapshots are immutable; corrections use separately recorded financial adjustments.';
