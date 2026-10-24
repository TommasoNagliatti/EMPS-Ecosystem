-- Apply only to the verified disposable emps_integration_test clone (3308).
-- Existing sandbox payments remain valid. No operational ledger is changed.
ALTER TABLE lab_charge_payments
  DROP CHECK chk_lab_payment_provider,
  ADD CONSTRAINT chk_lab_payment_provider CHECK (
    provider = 'sandbox' OR (provider = 'stripe_test' AND method = 'card')
  );
