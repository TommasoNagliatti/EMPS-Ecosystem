-- Audited disposable clone 127.0.0.1:3308 / emps_integration_test only.
-- Reuse expiring guest identities; no authenticatable users or operational payments.
ALTER TABLE lab_charge_intents
  MODIFY actor_user_id INTEGER UNSIGNED NULL,
  ADD COLUMN guest_id CHAR(36) NULL,
  ADD UNIQUE KEY uq_lab_intents_guest_key (guest_id, idempotency_key),
  ADD CONSTRAINT chk_lab_intent_subject CHECK (
    (actor_user_id IS NOT NULL AND guest_id IS NULL) OR
    (actor_user_id IS NULL AND guest_id IS NOT NULL AND station_id = 13)
  );
ALTER TABLE lab_charge_sessions MODIFY actor_user_id INTEGER UNSIGNED NULL;
